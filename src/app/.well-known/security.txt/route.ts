// RFC 9116 security.txt. Expires is computed at request time (~9 months out)
// so the field never goes stale.
export function GET(): Response {
  const expires = new Date(Date.now() + 270 * 24 * 60 * 60 * 1000).toISOString();

  const body = [
    "Contact: mailto:admin@ahousedividedgame.com",
    "Contact: https://github.com/Egg3901/AHDGame/security/advisories/new",
    `Expires: ${expires}`,
    "Canonical: https://ahousedividedgame.com/.well-known/security.txt",
    "Policy: https://github.com/Egg3901/AHDGame/blob/main/SECURITY.md",
    "Preferred-Languages: en",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
