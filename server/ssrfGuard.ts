// Shared SSRF allowlist used by every server-side image fetch we make.
// Only Bunny CDN (the user-configured pull zone + storage host) and BytePlus
// ARK image hosts are permitted. Internal/private hosts are explicitly blocked.

const ALLOWED_REMOTE_HOSTS = new Set<string>(
  [
    process.env.BUNNY_CDN_HOST,
    "storage.bunnycdn.com",
    "ark-content-generation-v2-ap-southeast.tos-ap-southeast-1.bytepluses.com",
    "tos-ap-southeast-1.bytepluses.com",
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
