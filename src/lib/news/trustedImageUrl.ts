/**
 * Accept only URLs we issued for news hero images (Blob or local dev uploads).
 * Prevents arbitrary remote URLs in stored posts.
 */
export function isTrustedNewsImageUrl(url: string): boolean {
  if (url.length > 2048) return false;

  if (url.startsWith("/api/uploads/news-images/")) {
    return !url.includes("..") && /^\/api\/uploads\/news-images\/[a-zA-Z0-9._-]+$/.test(url);
  }

  try {
    const u = new URL(url);
    if (u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com")) {
      return true;
    }
    // Cloudflare R2 — custom domain or *.r2.dev
    if (u.protocol === "https:") {
      const r2PublicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/$/, "");
      if (r2PublicUrl && url.startsWith(r2PublicUrl + "/")) {
        return true;
      }
      if (u.hostname.endsWith(".r2.dev")) {
        return true;
      }
    }
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      u.pathname.startsWith("/api/uploads/news-images/")
    ) {
      return !u.pathname.includes("..");
    }
    return false;
  } catch {
    return false;
  }
}
