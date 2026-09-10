/** Trusted profile images shared by the launcher and the desktop briefing. */
export function clientAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname;
    const trusted =
      host === "ahousedividedgame.com" ||
      host.endsWith(".ahousedividedgame.com") ||
      host === "cdn.discordapp.com" ||
      host.endsWith(".public.blob.vercel-storage.com");
    return url.protocol === "https:" && !url.username && !url.password && trusted ? url.href : null;
  } catch {
    return null;
  }
}
