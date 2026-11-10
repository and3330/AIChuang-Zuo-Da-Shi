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
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "AccessKey": this.accessKey,
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bunny upload failed: ${response.status} - ${errorText}`);
    }

    return this.getCdnUrl(remotePath);
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
