/**
 * Drama Compiler
 *
 * Stitches all scene videos of a drama episode into a single mp4 with
 * dialogue subtitles burned in. Uses ffmpeg + libass.
 *
 * Pipeline:
 *  1. Download every scene video to /tmp/drama-<episodeId>/scene_<n>.mp4
 *  2. Generate dialogue.ass with timing derived from each scene's duration
 *  3. Re-encode all clips into a uniform format (h264 + aac) and concat
 *     while applying the subtitle overlay in one ffmpeg pass
 *  4. Upload the final file to Bunny CDN under users/<folder>/videos/
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { BunnyStorageService } from "./bunnyStorage";

const execFileAsync = promisify(execFile);

// ─── Font management ─────────────────────────────────────────────────────────
const FONT_DIR = path.resolve(process.cwd(), "server/fonts");
const FONT_FILE = path.join(FONT_DIR, "NotoSansCJKtc-Regular.otf");
const FONT_URL =
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansCJKtc-Regular.otf";
const FONT_NAME = "Noto Sans CJK TC";

// Mirror URLs in case jsdelivr is throttled
const FONT_URLS = [
  FONT_URL,
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/TC/NotoSansCJKtc-Regular.otf",
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/TC/NotoSansCJKtc-Regular.otf",
];

let fontReady = false;
async function ensureFont(): Promise<string> {
  if (fontReady) return FONT_FILE;
  await fs.mkdir(FONT_DIR, { recursive: true });
  try {
    const stat = await fs.stat(FONT_FILE);
    if (stat.size > 100_000) {
      fontReady = true;
      return FONT_FILE;
    }
  } catch {}

  let lastErr: any = null;
  for (const url of FONT_URLS) {
    try {
      console.log(`[DramaCompiler] Downloading CJK font from ${url}…`);
      const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 100_000) throw new Error(`File too small (${buf.length}b)`);
      await fs.writeFile(FONT_FILE, buf);
      fontReady = true;
      console.log(`[DramaCompiler] Font cached at ${FONT_FILE} (${buf.length} bytes)`);
      return FONT_FILE;
    } catch (e: any) {
      lastErr = e;
      console.warn(`[DramaCompiler] Font mirror failed: ${e.message}`);
    }
  }
  throw new Error(`字型下載失敗，請稍後重試：${lastErr?.message || "unknown"}`);
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface CompileScene {
  /** 1-based scene number for display */
  sceneNumber: number;
  /** Public URL of the scene video on Bunny CDN (or fallback origin) */
  videoUrl: string;
  /** Scene duration in seconds (used to time subtitles) */
  duration: number;
  /** Optional dialogue line(s) — appears as burned-in subtitle */
  dialogue?: string;
}

export interface CompileEpisodeOpts {
  episodeId: string;
  userFolder: string;
  scenes: CompileScene[];
  bunny: BunnyStorageService;
  /** Output filename prefix (no extension) */
  outputName?: string;
  /**
   * Crossfade duration in milliseconds between adjacent scenes.
   * 0 = hard cut (legacy behaviour). Default 400ms.
   * Clamped to [0, 2000] and additionally to half the shortest clip.
   */
  crossfadeMs?: number;
}

export interface CompileEpisodeResult {
  /** Final CDN URL */
  videoUrl: string;
  /** Total duration in seconds */
  totalDuration: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(t: string): string {
  // ASS dialogue line escapes
  return t
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\N")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

/**
 * Build an ASS subtitle file with stylish lower-third subtitles.
 * Returns the ass file path.
 *
 * `durations` is the per-scene clip duration (seconds) used for cumulative
 * timing. When `crossfadeSec > 0`, each subsequent scene starts earlier in
 * the output timeline (overlap = crossfadeSec) and the subtitle window is
 * tightened by half the crossfade on each side so that lines do not bleed
 * into the visual transition.
 */
async function buildAssFile(
  scenes: CompileScene[],
  durations: number[],
  outDir: string,
  crossfadeSec: number = 0
): Promise<string | null> {
  const events: string[] = [];
  let cursor = 0;
  const halfFade = crossfadeSec / 2;
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const dur = Math.max(1, durations[i] || sc.duration || 5);
    const dialogue = (sc.dialogue || "").trim();
    if (dialogue) {
      const startPad = i > 0 ? halfFade : 0;
      const endPad = i < scenes.length - 1 ? halfFade : 0.1;
      const startSec = cursor + startPad;
      const endSec = Math.max(startSec + 0.5, cursor + dur - endPad);
      events.push(
        `Dialogue: 0,${formatAssTime(startSec)},${formatAssTime(endSec)},Default,,0,0,0,,${escapeAssText(dialogue)}`
      );
    }
    cursor += dur - (i < scenes.length - 1 ? crossfadeSec : 0);
  }
  if (events.length === 0) return null;

  // Use 1080x1920 reference for vertical (9:16) — libass scales to actual video
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${FONT_NAME},58,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,60,60,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;

  const assPath = path.join(outDir, "subs.ass");
  await fs.writeFile(assPath, ass, "utf8");
  return assPath;
}

/**
 * Allow-list of host suffixes the server will fetch scene videos from.
 * Prevents SSRF where a user-edited scene URL could target an internal IP.
 */
const ALLOWED_HOST_SUFFIXES = [
  "b-cdn.net",       // Bunny CDN
  "bunnycdn.com",
  ".replit.app",     // our own deployments
  ".repl.co",
];

function isAllowedMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    // Block obvious private/loopback targets
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return false;
    }
    return ALLOWED_HOST_SUFFIXES.some(suffix =>
      suffix.startsWith(".") ? host.endsWith(suffix) : host === suffix || host.endsWith("." + suffix)
    );
  } catch {
    return false;
  }
}

async function downloadVideo(url: string, dest: string): Promise<void> {
  if (!isAllowedMediaUrl(url)) {
    throw new Error(`不允許的影片來源網址：${url.slice(0, 80)}`);
  }
  const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`Download failed (${resp.status}) for ${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(dest, buf);
}

/**
 * Use ffprobe to detect whether a file actually has an audio stream.
 * Returns true on detect failure (assume audio) to avoid wrong silencing.
 */
async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=codec_type",
      "-of", "default=nw=1:nk=1",
      filePath,
    ], { timeout: 15_000 });
    return stdout.trim().length > 0;
  } catch {
    return true;
  }
}

/**
 * Probe the actual container duration in seconds. Returns null on failure
 * so callers can fall back to the requested clip duration.
 */
async function probeDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1",
      filePath,
    ], { timeout: 15_000 });
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/**
 * Run ffmpeg with concat + (optional) subtitle burn in one pass.
 * Re-encodes everything to h264 1080x1920 30fps + aac 128k for predictable
 * output regardless of source variability.
 *
 * When `crossfadeSec > 0` and there are 2+ scenes, adjacent clips are joined
 * with `xfade` (video) and `acrossfade` (audio) instead of a hard cut.
 */
async function runFfmpegConcat(
  videoPaths: string[],
  audioFlags: boolean[],
  durations: number[],
  assPath: string | null,
  fontDir: string,
  crossfadeSec: number,
  outputPath: string
): Promise<void> {
  const n = videoPaths.length;
  const useXfade = crossfadeSec > 0 && n >= 2;

  const args: string[] = ["-y"];
  for (const vp of videoPaths) args.push("-i", vp);
  // Add a silent audio source as the LAST input — we route any clip without
  // its own audio stream to a slice of this silence so concat stays in sync.
  const silentInputIdx = n;
  args.push("-f", "lavfi", "-t", "9999", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");

  const segments: string[] = [];
  // Normalize each input: scale + sar + fps + pad to 1080x1920.
  // For xfade we additionally lock pixel format here so the transition has a
  // consistent colour space across the whole pipeline.
  for (let i = 0; i < n; i++) {
    segments.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`
    );
    if (audioFlags[i]) {
      segments.push(
        `[${i}:a]aresample=async=1:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`
      );
    } else {
      // Use silence input for clips that lack an audio stream — trim it to
      // this scene's duration so acrossfade has a finite stream to work with.
      const trimDur = Math.max(0.1, durations[i]).toFixed(3);
      segments.push(
        `[${silentInputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${trimDur},asetpts=PTS-STARTPTS[a${i}]`
      );
    }
  }

  let finalVideoLabel: string;
  let finalAudioLabel: string;

  if (!useXfade) {
    // Hard-cut concat (legacy)
    let concatIns = "";
    for (let i = 0; i < n; i++) concatIns += `[v${i}][a${i}]`;
    segments.push(`${concatIns}concat=n=${n}:v=1:a=1[vc][ac]`);
    finalVideoLabel = "vc";
    finalAudioLabel = "ac";
  } else {
    // Pairwise xfade chain. xfade(A, B, d, offset) outputs duration
    // (offset + duration_B); equivalently, total length grows by
    // (duration_B - crossfadeSec) per added clip.
    const cfStr = crossfadeSec.toFixed(3);
    let prevV = "v0";
    let prevA = "a0";
    let cumOut = durations[0]; // current accumulated stream duration
    for (let i = 1; i < n; i++) {
      const offset = Math.max(0, cumOut - crossfadeSec).toFixed(3);
      const isLast = i === n - 1;
      const outV = isLast ? "vc" : `vx${i}`;
      const outA = isLast ? "ac" : `ax${i}`;
      segments.push(
        `[${prevV}][v${i}]xfade=transition=fade:duration=${cfStr}:offset=${offset}[${outV}]`
      );
      segments.push(
        `[${prevA}][a${i}]acrossfade=d=${cfStr}:c1=tri:c2=tri[${outA}]`
      );
      prevV = outV;
      prevA = outA;
      cumOut = cumOut + durations[i] - crossfadeSec;
    }
    finalVideoLabel = "vc";
    finalAudioLabel = "ac";
  }

  // Optional subtitle burn — applied AFTER the concat/xfade stage so the
  // subtitle ASS file's timeline matches the final output timeline.
  if (assPath) {
    const escapedAss = assPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const escapedFontsDir = fontDir.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    segments.push(
      `[${finalVideoLabel}]ass='${escapedAss}':fontsdir='${escapedFontsDir}'[vsub]`
    );
    finalVideoLabel = "vsub";
  }

  args.push(
    "-filter_complex",
    segments.join(";"),
    "-map",
    `[${finalVideoLabel}]`,
    "-map",
    `[${finalAudioLabel}]`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath
  );

  await execFileAsync("ffmpeg", args, {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000, // 15 min hard cap
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function compileEpisode(
  opts: CompileEpisodeOpts
): Promise<CompileEpisodeResult> {
  if (opts.scenes.length === 0) throw new Error("沒有可剪接的場景");

  // Validate every scene has a video URL
  const missing = opts.scenes.filter((s) => !s.videoUrl);
  if (missing.length > 0) {
    throw new Error(
      `第 ${missing.map((m) => m.sceneNumber).join("、")} 幕還沒生成影片，無法剪接`
    );
  }

  const fontPath = await ensureFont();
  const fontDir = path.dirname(fontPath);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `drama-${opts.episodeId}-`));
  console.log(`[DramaCompiler] workDir=${workDir} (${opts.scenes.length} scenes)`);

  try {
    // 1. Download all scene videos
    const videoPaths: string[] = [];
    for (let i = 0; i < opts.scenes.length; i++) {
      const dest = path.join(workDir, `scene_${String(i).padStart(3, "0")}.mp4`);
      console.log(`[DramaCompiler] Downloading scene ${i + 1}/${opts.scenes.length}…`);
      await downloadVideo(opts.scenes[i].videoUrl, dest);
      videoPaths.push(dest);
    }

    // 2. Probe audio streams + actual durations (some clips may have no audio
    //    and reported scene durations may differ from container length).
    const audioFlags: boolean[] = [];
    const durations: number[] = [];
    for (let i = 0; i < videoPaths.length; i++) {
      audioFlags.push(await hasAudioStream(videoPaths[i]));
      const probed = await probeDuration(videoPaths[i]);
      durations.push(
        probed ?? Math.max(1, opts.scenes[i].duration || 5)
      );
    }
    console.log(`[DramaCompiler] audio per scene: ${audioFlags.map(b => b ? "Y" : "n").join("")}`);
    console.log(`[DramaCompiler] durations: ${durations.map(d => d.toFixed(2)).join(",")}`);

    // 3. Resolve effective crossfade. Clamp to [0, 2000ms] and to less than
    //    half the shortest clip so the transition never swallows a whole scene.
    const requestedMs = opts.crossfadeMs ?? 400;
    const clampedMs = Math.max(0, Math.min(2000, Math.round(requestedMs)));
    const minClip = durations.length > 0 ? Math.min(...durations) : 5;
    const maxAllowedSec = Math.max(0, minClip / 2 - 0.05);
    const crossfadeSec = videoPaths.length >= 2
      ? Math.min(clampedMs / 1000, maxAllowedSec)
      : 0;
    console.log(`[DramaCompiler] crossfade requested=${clampedMs}ms effective=${(crossfadeSec * 1000).toFixed(0)}ms`);

    // 4. Build subtitle file (may be null if no dialogue at all)
    const assPath = await buildAssFile(opts.scenes, durations, workDir, crossfadeSec);
    console.log(`[DramaCompiler] subtitles=${assPath ? "yes" : "none"}`);

    // 5. Run ffmpeg
    const outputPath = path.join(workDir, "final.mp4");
    console.log(`[DramaCompiler] Running ffmpeg concat…`);
    await runFfmpegConcat(videoPaths, audioFlags, durations, assPath, fontDir, crossfadeSec, outputPath);

    // 6. Upload to Bunny CDN
    const buf = await fs.readFile(outputPath);
    console.log(`[DramaCompiler] Final size: ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
    const baseName = opts.outputName || `drama_compiled_${opts.episodeId}`;
    const remotePath = `users/${opts.userFolder}/videos/${baseName}.mp4`;
    const cdnUrl = await opts.bunny.uploadBuffer(buf, remotePath);

    // Total output duration accounts for the (N-1) crossfade overlaps.
    const sum = durations.reduce((s, d) => s + d, 0);
    const overlap = Math.max(0, durations.length - 1) * crossfadeSec;
    const totalDuration = Math.max(0, sum - overlap);

    return { videoUrl: cdnUrl, totalDuration };
  } finally {
    // Best-effort cleanup
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {}
  }
}
