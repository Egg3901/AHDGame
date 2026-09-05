import { NextResponse } from "next/server";
import { assertSingleplayerAllowed, isLoopbackOrigin, isSingleplayer } from "@/lib/singleplayer";

/**
 * Gate for the handful of routes that only exist for a local singleplayer
 * install: the launcher and the in-app new-game screen.
 *
 * Two checks, both must pass. `assertSingleplayerAllowed` throws on any
 * deployment marker so these routes can never be reached on a hosted copy,
 * and the Host header must be loopback so nothing else on the player's
 * network can reset their world. Outside singleplayer the answer is 404, not
 * 403: the routes do not exist as far as the deployed app is concerned.
 */
export function requireSingleplayer(request: Request): NextResponse | null {
  if (!isSingleplayer()) {
    return new NextResponse(null, { status: 404 });
  }
  assertSingleplayerAllowed();
  const host = request.headers.get("host");
  if (!host || !isLoopbackOrigin(`http://${host}`)) {
    return NextResponse.json(
      { error: "Singleplayer routes only answer on loopback" },
      { status: 403 }
    );
  }
  return null;
}
