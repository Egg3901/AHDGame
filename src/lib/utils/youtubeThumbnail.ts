/**
 * Build the album-art thumbnail URL for a YouTube video.
 *
 * Uses `hqdefault.jpg` — the only still that YouTube guarantees for every
 * video (480×360). `maxresdefault.jpg` exists only when the uploader provided
 * an HD thumbnail, so it 404s for most videos; a 404 upstream fed to next/image
 * during streaming SSR surfaces as the framework-internal
 * `controller[kState].transformAlgorithm is not a function` error
 * (vercel/next.js#75995). Callers must pass an already-extracted 11-char id.
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}
