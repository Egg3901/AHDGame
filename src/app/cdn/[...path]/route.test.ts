import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fsp } from "fs";
import path from "path";
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it("rejects oversized upstream assets without caching them", async () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("x", { headers: { "content-length": String(21 * 1024 * 1024) } })
      );
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(["static", "oversized.webp"])).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fetches upstream with an abort signal and publishes via tmp + rename", async () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    vi.spyOn(fsp, "readFile").mockRejectedValue(new Error("ENOENT"));
    vi.spyOn(fsp, "mkdir").mockResolvedValue(undefined);
    const writeFile = vi.spyOn(fsp, "writeFile").mockResolvedValue(undefined);
    const rename = vi.spyOn(fsp, "rename").mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response("geo", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await call(["static", "maps", "countries-110m.json"]);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("geo");
    // The upstream fetch is bounded by an AbortSignal timeout.
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    // The file is written to a unique tmp path, then renamed onto the live
    // name so a torn write is never what the mirror serves.
    const tmp = writeFile.mock.calls[0]?.[0] as string;
    const dest = rename.mock.calls[0]?.[1] as string;
    expect(tmp).toMatch(/\.tmp$/);
    expect(tmp.startsWith(dest)).toBe(true);
    expect(rename).toHaveBeenCalledWith(
      tmp,
      expect.stringContaining(path.join("cdn", "static", "maps", "countries-110m.json"))
    );
  });

  it("serves the body even when the mirror write fails", async () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    vi.spyOn(fsp, "readFile").mockRejectedValue(new Error("ENOENT"));
    vi.spyOn(fsp, "mkdir").mockRejectedValue(new Error("read-only fs"));
    vi.spyOn(fsp, "rm").mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("geo", { status: 200 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await call(["static", "maps", "countries-110m.json"]);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("geo");
    expect(warn).toHaveBeenCalled();
  });
});
