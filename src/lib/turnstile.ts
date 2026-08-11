/**
 * Cloudflare Turnstile server-side verification.
 *
 * Fails OPEN (skips the check) when `TURNSTILE_SECRET_KEY` isn't configured —
 * matches how Discord/Google OAuth degrade to a "not configured" no-op
 * elsewhere in this codebase, so local dev and any deploy without Turnstile
 * keys set still works. Once the secret is configured, a missing or invalid
 * token fails CLOSED (rejected).
 */
export interface TurnstileVerifyResult {
  ok: boolean;
  /** True only when the secret key isn't configured — caller may choose to
   *  log this differently from a real rejection. */
  skipped?: boolean;
}

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };

  if (!token) return { ok: false };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return { ok: false };

    const data = (await res.json()) as { success?: boolean };
    return { ok: data.success === true };
  } catch {
    // Network/Cloudflare-outage failure — fail closed, same as an invalid token.
    return { ok: false };
  }
}
