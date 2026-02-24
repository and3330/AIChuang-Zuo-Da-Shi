const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || "";
const BUNNY_ACCESS_KEY = process.env.BUNNY_ACCESS_KEY || "";
const BUNNY_CDN_HOST = process.env.BUNNY_CDN_HOST || "";
const BUNNY_STORAGE_BASE = "https://storage.bunnycdn.com";

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

  async uploadImageFromUrl(sourceUrl: string, userId: string, generationId: string, index?: number): Promise<string> {
    const ext = "jpg";
    const filename = index !== undefined ? `${generationId}_${index}.${ext}` : `${generationId}.${ext}`;
    const remotePath = `users/${userId}/images/${filename}`;
    return this.uploadFromUrl(sourceUrl, remotePath);
  }

  async uploadVideoFromUrl(sourceUrl: string, userId: string, generationId: string): Promise<string> {
    const ext = "mp4";
    const filename = `${generationId}.${ext}`;
    const remotePath = `users/${userId}/videos/${filename}`;
    return this.uploadFromUrl(sourceUrl, remotePath);
  }
}
