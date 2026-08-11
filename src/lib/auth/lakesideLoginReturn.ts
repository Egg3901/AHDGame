const LAKESIDE_AHD_AUTH_ORIGIN = "https://auth.ahousedividedgame.com";

/** OAuth login-mode cookie that may hold a Lakeside SSO continuation URL. */
export const DISCORD_OAUTH_RETURN_URL_COOKIE = "discord_oauth_return_url";
export const GOOGLE_OAUTH_RETURN_URL_COOKIE = "google_oauth_return_url";

export function safeLakesideLoginReturn(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== LAKESIDE_AHD_AUTH_ORIGIN || url.pathname !== "/auth/ahd") return null;
    if (!url.searchParams.get("return")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function loginDestination(
  returnTo: string | null | undefined,
  user: { role: string; isAdmin: boolean; hasCompletedSetup: boolean }
): string {
  const lakesideReturn = safeLakesideLoginReturn(returnTo);
  if (lakesideReturn) return lakesideReturn;
  return user.role === "player" && !user.isAdmin && !user.hasCompletedSetup
    ? "/create-character"
    : "/profile";
}

/** Read+clear an OAuth return-url cookie (login or link flow). */
export function takeOAuthReturnUrlCookie(
  cookieStore: {
    get: (name: string) => { value: string } | undefined;
    delete: (name: string) => void;
  },
  cookieName: string
): string | null {
  const value = cookieStore.get(cookieName)?.value ?? null;
  cookieStore.delete(cookieName);
  return value;
}
