import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSingleplayer: vi.fn(),
  command: vi.fn(),
}));

vi.mock("@/lib/api/requireSingleplayer", () => ({
  requireSingleplayer: mocks.requireSingleplayer,
}));
vi.mock("@/lib/mongodb", () => ({
  getMongoClient: vi.fn(async () => ({ db: () => ({ command: mocks.command }) })),
}));

import { POST, isConnectionDrop } from "./route";

const request = () =>
  new Request("http://127.0.0.1:3111/api/singleplayer/shutdown", { method: "POST" });

describe("POST /api/singleplayer/shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSingleplayer.mockReturnValue(null);
  });

  it("is denied before it can reach the database", async () => {
    const denied = new Response(null, { status: 404 });
    mocks.requireSingleplayer.mockReturnValueOnce(denied);
    expect(await POST(request())).toBe(denied);
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("issues the shutdown command", async () => {
    mocks.command.mockResolvedValueOnce({ ok: 1 });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.command).toHaveBeenCalledWith({ shutdown: 1 });
  });

  it("treats the connection mongod drops while exiting as success", async () => {
    const dropped = new Error("connection 3 to 127.0.0.1:27117 closed");
    dropped.name = "MongoNetworkError";
    mocks.command.mockRejectedValueOnce(dropped);
    expect((await POST(request())).status).toBe(200);
  });

  it("reports any other failure", async () => {
    mocks.command.mockRejectedValueOnce(new Error("not authorized on admin"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "not authorized on admin" });
  });

  it("recognises the driver's ways of saying the server went away", () => {
    const named = new Error("x");
    named.name = "MongoTopologyClosedError";
    expect(isConnectionDrop(named)).toBe(true);
    expect(isConnectionDrop(new Error("socket hang up"))).toBe(true);
    expect(isConnectionDrop(new Error("not authorized"))).toBe(false);
    expect(isConnectionDrop("nope")).toBe(false);
  });
});
