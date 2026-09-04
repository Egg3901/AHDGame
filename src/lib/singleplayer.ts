/**
 * Singleplayer mode.
 *
 * A singleplayer world is this same application, running on the player's own
 * machine against a local database, with exactly one account in it. Nothing
 * about the game changes: the same pages, the same API routes, the same
 * simulation. What changes is that there is no one to authenticate against,
 * so the session is fixed rather than negotiated.
 *
 * That makes this module a deliberate authentication bypass, which is only
 * ever safe on a single-user machine. Everything below exists to make it
 * impossible to enable anywhere else. `assertSingleplayerAllowed` throws on
 * any host that looks like a deployment, and it throws rather than returning
 * false so a misconfigured server fails to boot instead of quietly serving
 * every request as the local player.
 *
 * The seam is the middleware (`src/proxy.ts`), which mints a normal signed
 * session cookie for the local player when one is absent. Nothing downstream
 * is special-cased: `verifyAuth`, the direct cookie readers in /api/auth/me
 * and /api/client-nav, and all 987 call sites see an ordinary logged-in
 * session. That is deliberate. An auth *bypass* would have to be re-applied
 * at every path that reads a session; a real session is read the same way by
 * all of them.
 *
 * This module must stay free of `mongodb` and other Node-only imports: the
 * middleware that consumes it runs on the Edge runtime.
 */

/**
 * The local player's user id. Fixed, so `verifyAuth` resolves a session
 * without a database round trip on every request. New-game setup writes the
 * user document under this id.
 *
 * 24 hex characters, as ObjectId requires. The leading bytes spell "PLAYER"
 * so the id is recognisable in a database dump.
 */
export const SINGLEPLAYER_USER_ID = "504c41594552" + "000000000001";

function flagIsSet(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/**
 * Signals that this process is a hosted deployment rather than a player's
 * machine. Any one of them is enough to refuse singleplayer.
 *
 * `NEXT_PUBLIC_BASE_URL` is included because the desktop build always points
 * at loopback: a public origin means this is serving somebody else.
 */
function deploymentSignals(env: NodeJS.ProcessEnv = process.env): string[] {
  const signals: string[] = [];
  if (env.RAILWAY_ENVIRONMENT_NAME) signals.push("RAILWAY_ENVIRONMENT_NAME");
  if (env.RAILWAY_SERVICE_NAME) signals.push("RAILWAY_SERVICE_NAME");
  if (env.RAILWAY_PROJECT_ID) signals.push("RAILWAY_PROJECT_ID");
  if (env.VERCEL_ENV) signals.push("VERCEL_ENV");
  if (env.KUBERNETES_SERVICE_HOST) signals.push("KUBERNETES_SERVICE_HOST");

  const baseUrl = env.NEXT_PUBLIC_BASE_URL?.trim();
  if (baseUrl && !isLoopbackOrigin(baseUrl)) signals.push("NEXT_PUBLIC_BASE_URL");

  const uri = (env.MONGODB_URI || env.MONGO_URL)?.trim();
  if (uri && !isLocalMongoUri(uri)) signals.push("MONGODB_URI");

  return signals;
}

/** True when an origin points at this machine and nowhere else. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * True when a Mongo URI addresses this machine. A singleplayer world that
 * can reach a shared cluster is not a singleplayer world, and would let the
 * fixed session read another environment's data.
 */
export function isLocalMongoUri(uri: string): boolean {
  if (uri.startsWith("mongodb+srv://")) return false;
  const hosts = uri
    .replace(/^mongodb:\/\//, "")
    .split("/")[0]
    .split("@")
    .pop();
  if (!hosts) return false;
  return hosts.split(",").every((hostPort) => {
    const host = hostPort.split(":")[0];
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  });
}

/**
 * Whether singleplayer has been requested. Requesting it is not the same as
 * being allowed it: call `assertSingleplayerAllowed` before acting on this.
 */
export function singleplayerRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return flagIsSet(env.SINGLEPLAYER);
}

export class SingleplayerNotAllowedError extends Error {
  constructor(signals: string[]) {
    super(
      `SINGLEPLAYER is set but this process looks like a hosted deployment ` +
        `(${signals.join(", ")}). Singleplayer replaces authentication with a ` +
        `fixed local session and must never run on a shared server. Refusing to start.`
    );
    this.name = "SingleplayerNotAllowedError";
  }
}

/**
 * Throws when singleplayer is requested on anything that looks like a server.
 * Safe to call when singleplayer is not requested: it does nothing.
 */
export function assertSingleplayerAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (!flagIsSet(env.SINGLEPLAYER)) return;
  const signals = deploymentSignals(env);
  if (signals.length > 0) throw new SingleplayerNotAllowedError(signals);
}

/**
 * The single question the rest of the app asks. Throws rather than returning
 * false on a deployment, so the bypass can never degrade into "off" on a
 * machine that was one env var away from serving every request as one user.
 */
export function isSingleplayer(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!flagIsSet(env.SINGLEPLAYER)) return false;
  assertSingleplayerAllowed(env);
  return true;
}

/** Whether the local player also gets the admin surfaces. Opt-in. */
export function singleplayerIsAdmin(env: NodeJS.ProcessEnv = process.env): boolean {
  return isSingleplayer(env) && flagIsSet(env.SINGLEPLAYER_ADMIN);
}

/**
 * The claim set for the local player's session, matching `userPayloadSchema`
 * in `@/lib/auth`. Signed by the middleware with the local `AUTH_SECRET`, so
 * downstream verification is the ordinary path and not a special case.
 */
export function singleplayerSessionClaims(env: NodeJS.ProcessEnv = process.env): {
  userId: string;
  email: string;
  username: string;
  role: string;
  isAdmin: boolean;
} {
  const isAdmin = singleplayerIsAdmin(env);
  return {
    userId: SINGLEPLAYER_USER_ID,
    email: "player@localhost",
    username: "player",
    role: isAdmin ? "admin" : "player",
    isAdmin,
  };
}
