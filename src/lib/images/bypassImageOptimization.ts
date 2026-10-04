import { CDN_BASE } from "@/lib/images/cdnUrls";

/**
 * When true, pass `unoptimized` to `next/image` so the browser loads the URL
 * directly instead of the Image Optimization API fetching it server-side.
 *
 * - `/api/images/*` routes redirect to Wikimedia; the optimizer does not reliably
 *   follow redirects to arbitrary hosts.
 * - `/api/logos/*` routes redirect to either a custom upload (Vercel Blob) or a
 *   default Wikimedia URL; same redirect-handling limitation applies.
 * - `/api/flags/*` routes proxy image content server-side; bypassing lets the
 *   browser hit the route directly and receive cached binary responses.
 * - `/api/uploads/*` routes serve local disk files; already pre-optimized via
 *   `optimizeImage`, so the optimization proxy adds no benefit and can fail
 *   when the server makes internal requests to itself in dev.
 * - Vercel Blob URLs (`*.public.blob.vercel-storage.com`) are public CDN URLs
 *   for pre-optimized images; the proxy layer adds latency without benefit.
 * - Direct Wikimedia/Wikipedia URLs often fail or throttle server-side fetches
 *   (hotlink/bot policies) while normal browser requests succeed.
 * - `flagcdn.com` serves tiny pre-sized country flags from a CDN; optimizer
 *   resizing offers no benefit and matches the bypass that the `/api/flags/country/*`
 *   redirect route relies on.
 */
export function bypassNextImageOptimization(src: string): boolean {
  if (!src) return false;
  try {
    const relativeOrigin = "https://relative.invalid";
    const url = new URL(src, relativeOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;

    // Host-prefixed API routes follow the same rules as relative API routes.
    const path = url.pathname;
    if (path.startsWith("/api/images/")) return true;
    if (path.startsWith("/api/logos/")) return true;
    if (path.startsWith("/api/flags/")) return true;
    if (path.startsWith("/api/uploads/")) return true;

    const hostname = url.hostname;
    if (hostname.endsWith(".public.blob.vercel-storage.com")) return true;
    if (hostname.endsWith(".r2.dev")) return true;

    // CDN_BASE may point to the singleplayer build's local /cdn mirror.
    const cdn = new URL(CDN_BASE, relativeOrigin);
    const cdnPath = `${cdn.pathname.replace(/\/$/, "")}/`;
    if (url.origin === cdn.origin && path.startsWith(cdnPath)) return true;

    return (
      url.protocol === "https:" &&
      [
        "cdn.ahousedividedgame.com",
        "upload.wikimedia.org",
        "commons.wikimedia.org",
        "en.wikipedia.org",
        "cdn.discordapp.com",
        "media.discordapp.net",
        "flagcdn.com",
      ].includes(hostname)
    );
  } catch {
    return false;
  }
}
