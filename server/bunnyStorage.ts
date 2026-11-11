import sharp from "sharp";

const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || "";
const BUNNY_ACCESS_KEY = process.env.BUNNY_ACCESS_KEY || "";
const BUNNY_CDN_HOST = process.env.BUNNY_CDN_HOST || "";
const BUNNY_STORAGE_BASE = "https://storage.bunnycdn.com";

export async function addWatermark(imageBuffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  const fontSize = Math.max(14, Math.floor(width / 55));
  const padding = Math.floor(fontSize * 1.0);
  const lineHeight = Math.floor(fontSize * 1.5);
  const lines = [
    "本圖片為 AI 生成",
    "使用 Seedream 5.5"
  ];
  const blockHeight = lines.length * lineHeight + padding * 2;
  const blockWidth = Math.floor(fontSize * 14);

  const svgOverlay = `
    <svg width="${blockWidth}" height="${blockHeight}">
      <rect x="0" y="0" width="${blockWidth}" height="${blockHeight}" rx="6" ry="6" fill="rgba(0,0,0,0.5)"/>
      ${lines.map((line, i) => `
        <text x="${blockWidth - padding}" y="${padding + (i + 1) * lineHeight - Math.floor(fontSize * 0.3)}" 
              font-family="Arial, Noto Sans CJK TC, sans-serif" font-size="${fontSize}" 
              fill="rgba(255,255,255,0.9)" text-anchor="end">${line}</text>
      `).join("")}
    </svg>`;

  return sharp(imageBuffer)
    .composite([{
      input: Buffer.from(svgOverlay),
      gravity: "southeast",
    }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

export class BunnyStorageService {
  private storageZone: string;
  private accessKey: string;
  private cdnHost: string;

  constructor() {
    this.storageZone = BUNNY_STORAGE_ZONE;
    this.accessKey = BUNNY_ACCESS_KEY;
    this.cdnHost = BUNNY_CDN_HOST;
  }

  isConfigured(): boolean {
    return !!(this.storageZone && this.accessKey && this.cdnHost);
  }

  private getStorageUrl(path: string): string {
    return `${BUNNY_STORAGE_BASE}/${this.storageZone}/${path}`;
  }

  getCdnUrl(path: string): string {
    const host = this.cdnHost.startsWith("http") ? this.cdnHost : `https://${this.cdnHost}`;
    return `${host}/${path}`;
  }

  async uploadFromUrl(sourceUrl: string, remotePath: string): Promise<string> {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to download from source: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return this.uploadBuffer(buffer, remotePath);
  }

  async uploadBuffer(buffer: Buffer, remotePath: string): Promise<string> {
    const url = this.getStorageUrl(remotePath);
    // A generated image has already been paid for, so a hiccup on the way to
    // the CDN is retried (network errors, 429 and 5xx) before giving up.
    const waits = [0, 1000, 3000, 8000];
    let lastError = "unknown";
    for (let attempt = 0; attempt < waits.length; attempt++) {
      if (waits[attempt] > 0) await new Promise(r => setTimeout(r, waits[attempt] * (0.75 + Math.random() * 0.5)));
      try {
        const response = await fetch(url, {
          method: "PUT",
          headers: {
            "AccessKey": this.accessKey,
            "Content-Type": "application/octet-stream",
          },
          body: buffer,
        });
        if (response.ok) return this.getCdnUrl(remotePath);
        lastError = `${response.status} - ${(await response.text()).slice(0, 200)}`;
        // Other 4xx (bad key, bad path) fail the same way every time.
        if (response.status !== 429 && response.status < 500) break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "network error";
      }
    }
    throw new Error(`Bunny upload failed: ${lastError}`);
  }

  /** True when the URL points at our own CDN host. */
  isOwnCdnUrl(url: string): boolean {
    try {
      const host = (this.cdnHost.startsWith("http") ? new URL(this.cdnHost).host : this.cdnHost).toLowerCase();
      const u = new URL(url);
      return u.protocol === "https:" && u.host.toLowerCase() === host;
    } catch { return false; }
  }

  /** Delete a file by its CDN URL. Refuses anything that is not on our CDN. */
  async deleteByCdnUrl(url: string): Promise<boolean> {
    if (!this.isConfigured() || !this.isOwnCdnUrl(url)) return false;
    const path = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
    if (!path || path.includes("..")) return false;
    const response = await fetch(this.getStorageUrl(path), { method: "DELETE", headers: { "AccessKey": this.accessKey } });
    return response.ok || response.status === 404;
  }

  async uploadImageFromUrl(sourceUrl: string, userFolder: string, generationId: string, index?: number): Promise<string> {
    const ext = "jpg";
    const filename = index !== undefined ? `${generationId}_${index}.${ext}` : `${generationId}.${ext}`;
    const remotePath = `users/${userFolder}/images/${filename}`;
    return this.uploadFromUrl(sourceUrl, remotePath);
  }

  async uploadVideoFromUrl(sourceUrl: string, userFolder: string, generationId: string): Promise<string> {
    const ext = "mp4";
    const filename = `${generationId}.${ext}`;
    const remotePath = `users/${userFolder}/videos/${filename}`;
    return this.uploadFromUrl(sourceUrl, remotePath);
  }
}
