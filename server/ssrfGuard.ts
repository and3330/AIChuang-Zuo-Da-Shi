// Shared SSRF allowlist used by every server-side image fetch we make.
// Only Bunny CDN (the user-configured pull zone + storage host) is permitted.
// Internal/private hosts are explicitly blocked.

const ALLOWED_REMOTE_HOSTS = new Set<string>(
  [
    process.env.BUNNY_CDN_HOST,
    "storage.bunnycdn.com",
  ].filter((h): h is string => !!h && h.length > 0)
);

export function assertAllowedRemoteUrl(rawUrl: string): URL {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`Disallowed protocol: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" || host === "0.0.0.0" || host === "::1" ||
    host.startsWith("127.") || host.startsWith("10.") ||
    host.startsWith("169.254.") || host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.endsWith(".internal") || host.endsWith(".local")
  ) {
    throw new Error(`Blocked internal host: ${host}`);
  }
  const allowed = Array.from(ALLOWED_REMOTE_HOSTS).some(allowedHost => {
    const a = allowedHost.toLowerCase();
    return host === a || host.endsWith("." + a);
  });
  if (!allowed) {
    throw new Error(`Disallowed remote host: ${host}`);
  }
  return u;
}

/** Non-throwing variant – returns null on rejection. */
export function safeRemoteUrl(rawUrl: string): URL | null {
  try { return assertAllowedRemoteUrl(rawUrl); } catch { return null; }
}

/**
 * Looser variant for providers whose CDN hosts we cannot enumerate ahead of
 * time (AtlasCloud hands back signed object-storage URLs). We still block internal/private targets and require
 * https, but skip the allowlist. Use this only with output URLs that come
 * from a trusted upstream API response — never from user input.
 */
export function assertPublicHttpsUrl(rawUrl: string): URL {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "https:") {
    throw new Error(`Disallowed protocol (https only): ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" || host === "0.0.0.0" || host === "::1" ||
    host.startsWith("127.") || host.startsWith("10.") ||
    host.startsWith("169.254.") || host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.endsWith(".internal") || host.endsWith(".local")
  ) {
    throw new Error(`Blocked internal host: ${host}`);
  }
  return u;
}

/**
 * Fetch a remote image with a hard byte cap, content-type check and timeout.
 * Returns the buffer or throws a descriptive error. Callers should run the
 * URL through `assertAllowedRemoteUrl` or `assertPublicHttpsUrl` *before*
 * calling this — this helper does NOT do its own host guard.
 */
export async function fetchImageWithLimits(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024; // 25 MB
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) {
      throw new Error(`下載圖片失敗 HTTP ${resp.status}`);
    }
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (ct && !ct.startsWith("image/")) {
      throw new Error(`回傳並非圖片 (content-type=${ct})`);
    }
    const lenHeader = resp.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > maxBytes) {
      throw new Error(`圖片過大 (${lenHeader} bytes > ${maxBytes})`);
    }
    const reader = resp.body?.getReader();
    if (!reader) {
      // Older runtimes — fall back to arrayBuffer with one more size check.
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.byteLength > maxBytes) {
        throw new Error(`圖片過大 (${buf.byteLength} bytes > ${maxBytes})`);
      }
      return buf;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error(`圖片過大 (>${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c)));
  } finally {
    clearTimeout(timer);
  }
}
