import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function call(segments: string[]) {
  return GET(new Request("http://127.0.0.1:3111/cdn/" + segments.join("/")), {
    params: Promise.resolve({ path: segments }),
  });
}

/**
 * The mirror writes whatever it fetches under the player's data directory,
 * so the path it accepts is the whole security story. Nothing here touches
 * the network or the disk: every case is rejected before either.
 */
describe("singleplayer CDN mirror", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not exist outside singleplayer", async () => {
    vi.stubEnv("SINGLEPLAYER", "");
    expect((await call(["static", "maps", "countries-110m.json"])).status).toBe(404);
  });

  it("rejects anything that could leave the mirror directory", async () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    expect((await call(["..", "auth-secret"])).status).toBe(400);
    expect((await call(["static", "..", "..", "etc", "passwd"])).status).toBe(400);
    expect((await call(["static", "maps", "a\\b.json"])).status).toBe(400);
    expect((await call(["static", "maps", "space name.json"])).status).toBe(400);
    expect((await call([])).status).toBe(400);
  });
});
