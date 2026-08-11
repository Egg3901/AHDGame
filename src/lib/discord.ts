export const DISCORD_OAUTH_SCOPES = "identify";

/**
 * Resolve a stored upload URL (e.g. an avatar) to an absolute, externally
 * fetchable URL. Avatars uploaded in local-storage mode are persisted as
 * root-relative paths (`/api/uploads/avatars/…`); relative URLs are rejected by
 * Discord's embed builder (`@sapphire/shapeshift` `url()` predicate), which
 * surfaces in the bot as a "connection failed" error. Absolutising at the
 * discord-bot API boundary keeps relative storage (portable across
 * environments) while handing Discord a URL it can actually fetch.
 *
 * Already-absolute URLs (R2/CDN, Discord CDN) pass through unchanged, so this
 * is safe to apply unconditionally and idempotently.
 */
export function toAbsoluteUploadUrl(
  url: string | null | undefined,
  baseUrl: string
): string | null {
  if (!url) {
    return null;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  const base = baseUrl.replace(/\/$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function getDiscordAvatarUrl(
  discordId: string,
  avatarHash: string | null | undefined
): string {
  if (avatarHash) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`;
  }
  const defaultIndex = Number(BigInt(discordId) % BigInt(5));
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

export function getDiscordOAuthUrl(state: string, redirectUri: string, clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DISCORD_OAUTH_SCOPES,
    state: state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; token_type: string }> {
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord token exchange failed: ${response.status}`);
  }

  return response.json();
}

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Discord user fetch failed: ${response.status}`);
  }

  return response.json();
}
