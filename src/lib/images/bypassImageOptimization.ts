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
  // Strip a leading http(s) origin so host-prefixed local API URLs (e.g. an
  // avatar stored as `http://localhost:3000/api/uploads/...`, or the production
  // `https://<host>/api/uploads/...`) match the same path rules as relative
  // ones. Without this, next/image tries to optimize them and rejects the host
  // unless it is in `remotePatterns`. The absolute CDN/host checks below still
  // test the full `src`.
  const path = src.replace(/^https?:\/\/[^/]+/, "");
  if (path.startsWith("/api/images/")) return true;
  if (path.startsWith("/api/logos/")) return true;
  if (path.startsWith("/api/flags/")) return true;
  if (path.startsWith("/api/uploads/")) return true;
  if (src.includes(".public.blob.vercel-storage.com/")) return true;
  if (src.includes(".r2.dev/")) return true;
  // CDN_BASE is the production host by default and a local `/cdn` mirror in a
  // singleplayer build; either way the art is already final-form and must not
  // be re-encoded by /_next/image.
  if (src.startsWith(`${CDN_BASE}/`)) return true;
  if (src.startsWith("https://cdn.ahousedividedgame.com/")) return true;
  if (src.startsWith("https://upload.wikimedia.org/")) return true;
  if (src.startsWith("https://commons.wikimedia.org/")) return true;
  // Fair-use logos live on the language wikis, not Commons (union emblems,
  // UK:UUP). Without this they route through /_next/image, whose host
  // allow-list rejects them with a 400 and the caller renders its fallback.
  if (src.startsWith("https://en.wikipedia.org/")) return true;
  if (src.startsWith("https://cdn.discordapp.com/")) return true;
  if (src.startsWith("https://media.discordapp.net/")) return true;
  if (src.startsWith("https://flagcdn.com/")) return true;
  return false;
}
