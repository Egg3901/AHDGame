import { afterEach, describe, expect, it, vi } from "vitest";
import { requireSingleplayer } from "./requireSingleplayer";

function request(host: string | null): Request {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  return new Request("http://example.test/api/singleplayer/status", { headers });
}

/**
 * These routes can reset the player's world, so the gate has to be strict in
 * both directions: invisible on a deployment, and loopback-only locally.
 */
describe("requireSingleplayer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 404 outside singleplayer, as if the route did not exist", () => {
    vi.stubEnv("SINGLEPLAYER", "");
    const denied = requireSingleplayer(request("127.0.0.1:3111"));
    expect(denied?.status).toBe(404);
  });

  it("refuses a non-loopback host even in singleplayer", () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    expect(requireSingleplayer(request("192.168.1.20:3111"))?.status).toBe(403);
    expect(requireSingleplayer(request("game.example.com"))?.status).toBe(403);
    expect(requireSingleplayer(request(null))?.status).toBe(403);
  });

  it("lets loopback through", () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    expect(requireSingleplayer(request("127.0.0.1:3111"))).toBeNull();
    expect(requireSingleplayer(request("localhost:3111"))).toBeNull();
    expect(requireSingleplayer(request("[::1]:3111"))).toBeNull();
  });
});
