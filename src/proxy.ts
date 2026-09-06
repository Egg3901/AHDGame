import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import { getCachedMaintenanceStatus, isMaintenanceBypassPath } from "@/lib/maintenanceStatus";
import { getCachedPublicViewingMode, isPublicApiReadBypassPath } from "@/lib/publicViewing";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import { CHARACTER_GATE_COOKIE, isCharacterGatedPath } from "@/lib/auth/characterGate";
import { isSingleplayer, singleplayerSessionClaims } from "@/lib/singleplayer";

// Well-known root files that must never be rewritten under /wiki on the
// subdomain — /robots.txt would otherwise hit the wiki [slug] route and serve
// an HTML "Not Found" page instead of the metadata route.
const WIKI_PASSTHROUGH_PATHS = new Set([
  "/robots.txt",
  "/sitemap.xml",
  "/ads.txt",
  "/manifest.webmanifest",
]);

/**
 * Keep the raw Railway host (and any other non-canonical *.up.railway.app host)
 * out of the search index — it serves a full duplicate of the site.
 */
function withRailwayNoindex(response: NextResponse, host: string): NextResponse {
  if (host.endsWith(".up.railway.app")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

function getJwtSecret(): Uint8Array | null {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/** Verify the auth cookie and return its JWT payload, or null when absent/invalid. */
async function verifySession(request: NextRequest): Promise<Record<string, unknown> | null> {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  const secret = getJwtSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function requestIsAdmin(request: NextRequest): Promise<boolean> {
  const payload = await verifySession(request);
  return payload?.isAdmin === true;
}

/**
 * Read-gate for internal API routes. When "public viewing mode" is off, anonymous
 * GET/HEAD requests to internal routes are rejected so scrapers can't treat the
 * page-serving JSON endpoints as a free, unauthenticated API. Writes keep their
 * own per-route auth; self-protected and pre-login namespaces stay reachable.
 */
async function handleApiReadGate(request: NextRequest): Promise<NextResponse> {
  const method = request.method.toUpperCase();
  // Only reads are gated here — mutating routes already enforce their own auth.
  if (method !== "GET" && method !== "HEAD") return NextResponse.next();

  // Default-on flag: a DB blip fails open (never 401 every read on a hiccup).
  let publicViewing = true;
  try {
    publicViewing = await getCachedPublicViewingMode();
  } catch (err) {
    console.warn("[proxy] public-viewing lookup failed; allowing read", err);
    return NextResponse.next();
  }
  if (publicViewing) return NextResponse.next();

  const { pathname } = request.nextUrl;
  // Self-protected (own key/token/signature) or pre-login/asset namespaces.
  if (isPublicApiReadBypassPath(pathname)) return NextResponse.next();

  // Any authenticated session may read.
  if (await verifySession(request)) return NextResponse.next();

  return NextResponse.json(
    { error: "Public viewing is disabled. Sign in to view this content." },
    { status: 401 }
  );
}

/**
 * Inject the current pathname/search into request headers so server components
 * can read them via headers() without client-only workarounds.
 */
function passthrough(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  requestHeaders.set("x-search", request.nextUrl.search);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const singleplayer = isSingleplayer();

  // Singleplayer: one account, on the player's machine, nobody to log in as.
  // Mint the local player's session here rather than special-casing auth
  // downstream, so every route reads an ordinary logged-in session. Returns
  // early with the cookie attached; the retried request then flows through
  // the normal path below. See @/lib/singleplayer for the guards that stop
  // this running anywhere that serves more than one person.
  if (singleplayer && !request.cookies.get(AUTH_COOKIE_NAME)) {
    return await grantSingleplayerSession(request);
  }

  // The local build has no account lifecycle. Keep old bookmarks to the
  // public auth pages inside the local launcher rather than showing a sign-in,
  // registration, or logout screen for the fixed local session.
  if (
    singleplayer &&
    (pathname === "/login" || pathname === "/register" || pathname === "/logout")
  ) {
    return NextResponse.redirect(new URL("/singleplayer", request.url));
  }

  // Canonical host is the apex domain. www duplicates every page (splits SEO
  // signals and confuses the AdSense review), so 301 it. The raw Railway host
  // is NOT redirected — deploy healthchecks hit /api/health on it — it gets an
  // X-Robots-Tag: noindex header on its passthrough response instead.
  //
  // NEVER redirect /api/* : a 301 downgrades POST/PATCH to a bodyless GET, so
  // any API client that targets www (e.g. the Discord ticket/suggestion intake
  // bot, whose GAME_API_URL points at www) silently loses every write. API
  // routes aren't indexed, so they don't need canonicalization — let them fall
  // through to the read-gate below and reach the route on whichever host.
  if (host === "www.ahousedividedgame.com" && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = "ahousedividedgame.com";
    url.port = "";
    return NextResponse.redirect(url, 301);
  }

  // Internal API routes get the read-gate, not the page maintenance/redirect
  // path. Returning here keeps maintenance HTML redirects from being served to
  // API clients (which expect JSON) once `/api/` is in the matcher. Runs
  // host-independently so the gate also covers the wiki subdomain.
  if (pathname.startsWith("/api/")) {
    return handleApiReadGate(request);
  }

  // Wiki subdomain rewrite: / → /wiki, /elections/123 → /wiki/elections/123.
  // Page routes only — /api/* is handled above. Already-correct /wiki paths and
  // well-known root files pass through untouched (with header injection so the
  // wiki server components still see x-pathname).
  if (host === "wiki.ahousedividedgame.com" || host.startsWith("wiki.")) {
    // host.startsWith("wiki.") covers wiki.localhost for local dev and any staging subdomain
    if (pathname.startsWith("/wiki") || WIKI_PASSTHROUGH_PATHS.has(pathname)) {
      // Dynamic /wiki/* hrefs intentionally retain the prefix so they resolve
      // on both ahousedividedgame.com/wiki/* and this subdomain.
      return withRailwayNoindex(passthrough(request), host);
    }
    const url = request.nextUrl.clone();
    url.pathname = `/wiki${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // Character-creation gate: a logged-in player with no active character is
  // pushed to /create-character on every gated page. The DB-backed truth lives
  // in the `ahd-needs-character` hint cookie, which /api/auth/me keeps fresh on
  // every page load (so reset/retired/game-event character loss self-heals).
  // This is a UX redirect only — real data access stays guarded per route.
  const hasAuth = request.cookies.has(AUTH_COOKIE_NAME);
  const needsCharacter = request.cookies.get(CHARACTER_GATE_COOKIE)?.value === "1";
  if (hasAuth && needsCharacter && isCharacterGatedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/create-character";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Maintenance enforcement runs in the proxy (not just the root layout)
  // because `redirect()` from a layout is not honored for RSC navigation
  // requests in Next.js 16 — the layout runs, redirect is called, but the
  // response still returns the page content as a 200 RSC payload. Gating in
  // the proxy intercepts both hard loads and RSC requests.
  if (!isMaintenanceBypassPath(pathname)) {
    // Fail-open if the maintenance lookup throws (e.g. transient DB blip):
    // a 500 from the proxy would take down every page hit, which is worse
    // than briefly letting a request through.
    //
    // Only "full" redirects every page. "Partial" leaves pages reachable —
    // registration/character-creation are blocked at the mutation routes
    // instead (see POST /api/auth/register, /api/auth/character).
    let maintenanceMode: "off" | "partial" | "full" = "off";
    try {
      const maintenance = await getCachedMaintenanceStatus();
      maintenanceMode = maintenance.mode;
    } catch (err) {
      console.warn("[proxy] maintenance lookup failed; passing through", err);
    }
    if (maintenanceMode === "full" && !(await requestIsAdmin(request))) {
      return NextResponse.redirect(new URL("/maintenance", request.url));
    }
  }

  return withRailwayNoindex(passthrough(request), host);
}

/**
 * Issue the local player's session cookie and re-run the request with it.
 *
 * The cookie is set on the forwarded request headers as well as the response
 * so the very first request already carries a session, rather than bouncing
 * the player through an unauthenticated render.
 */
async function grantSingleplayerSession(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("SINGLEPLAYER is set but AUTH_SECRET is missing; cannot mint a local session.");
  }

  const token = await new SignJWT(singleplayerSessionClaims())
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10y")
    .sign(new TextEncoder().encode(secret));

  const requestHeaders = new Headers(request.headers);
  const existing = requestHeaders.get("cookie");
  requestHeaders.set(
    "cookie",
    existing ? `${existing}; ${AUTH_COOKIE_NAME}=${token}` : `${AUTH_COOKIE_NAME}=${token}`
  );

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    // Loopback is not a secure origin in the browser's eyes; a Secure cookie
    // over plain http would be dropped and the player would never get a session.
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365 * 10,
  });
  return response;
}

export const config = {
  matcher: [
    // `.json` is excluded alongside the image formats because /public ships the
    // map region shards (germany-regions.json, ru-regions.json, the union
    // republics) and the landing globe fetches them from a PUBLIC page. Without
    // this they go through the maintenance gate, get a 307 to /maintenance, and
    // resolve as HTML — so `response.json()` throws, the globe's catch swallows
    // it, and Germany silently renders undivided while the page around it looks
    // perfectly fine. Static geometry has no game state in it and nothing to
    // seal.
    "/((?!api/|_next/static|_next/image|monitoring|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json)$).*)",
    // Internal API routes — the read-gate above runs only when public viewing
    // mode is off, so this is a no-op pass-through during normal operation.
    "/api/:path*",
  ],
};
