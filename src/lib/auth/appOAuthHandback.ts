import { isStoreAppUserAgent } from "@/lib/displayMode";

/**
 * The Android AHDClient hands Discord's consent page to the system, so the
 * Discord app (or the phone's browser) can use the player's existing Discord
 * login. Discord then redirects to our callback. When the Discord app opens
 * that link, the verified App Link brings it back into the app. When a browser
 * follows the redirect instead, browsers never pass a redirect to an app, so
 * the callback loads in the browser, which has none of the OAuth cookies the
 * app's webview set, and sign-in failed with "Session expired" (ticket 1461).
 *
 * Sign-ins started in the app carry this prefix in their OAuth state. A
 * callback that arrives in a browser without the OAuth cookies but with this
 * prefix gets a page that hands the same callback URL back to the app, where
 * the webview still holds the state cookie that authorizes it.
 */
export const APP_OAUTH_STATE_PREFIX = "app-";

const ANDROID_PACKAGE = "net.lakesidegames.ahdclient";

/** OAuth state for a sign-in starting in this request's browser or app. */
export function oauthStateFor(userAgent: string | null, random: string): string {
  return userAgent && isStoreAppUserAgent(userAgent) && /Android/i.test(userAgent)
    ? `${APP_OAUTH_STATE_PREFIX}${random}`
    : random;
}

/**
 * True when a callback should go back to the app instead of failing here:
 * the state says the app started it and this request is not the app.
 */
export function shouldHandBackToApp(
  state: string | null,
  code: string | null,
  userAgent: string | null
): boolean {
  return (
    !!code &&
    !!state &&
    state.startsWith(APP_OAUTH_STATE_PREFIX) &&
    /^[A-Za-z0-9._~-]{1,512}$/.test(state) &&
    /^[A-Za-z0-9._~-]{1,512}$/.test(code) &&
    !(userAgent && isStoreAppUserAgent(userAgent))
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * An Android intent link that opens exactly this callback in the app. With a
 * package name the browser never falls back to loading it itself.
 */
export function appCallbackIntent(callbackUrl: URL): string {
  const target = `${callbackUrl.host}${callbackUrl.pathname}${callbackUrl.search}`;
  return `intent://${target}#Intent;scheme=https;package=${ANDROID_PACKAGE};end`;
}

/** A small page that returns the player to the app to finish signing in. */
export function appHandbackPage(callbackUrl: URL): Response {
  const intent = escapeHtml(appCallbackIntent(callbackUrl));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Finish signing in | A House Divided</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#14141c;color:#e8e8ef;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:22rem;padding:2rem 1.5rem;text-align:center}
h1{font-size:1.25rem;margin:0 0 .75rem}
p{color:#a9a9b8;line-height:1.5;margin:0 0 1.5rem}
a.button{display:inline-block;background:#c8202f;color:#fff;text-decoration:none;font-weight:600;padding:.8rem 1.4rem;border-radius:.5rem}
</style>
</head>
<body>
<main>
<h1>Finish signing in</h1>
<p>Discord approved your sign-in. Return to the A House Divided app to finish.</p>
<a class="button" id="return" href="${intent}">Return to the app</a>
</main>
<script>setTimeout(function(){location.href=document.getElementById("return").href},150)</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
