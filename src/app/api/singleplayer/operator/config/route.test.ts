import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSingleplayer: vi.fn(),
  getDb: vi.fn(),
  canOperateSingleplayerWorld: vi.fn(),
  getSingleplayerConfig: vi.fn(),
  setSingleplayerConfig: vi.fn(),
}));

vi.mock("@/lib/api/requireSingleplayer", () => ({
  requireSingleplayer: mocks.requireSingleplayer,
}));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/singleplayerOperator", () => ({
  canOperateSingleplayerWorld: mocks.canOperateSingleplayerWorld,
}));
vi.mock("@/lib/singleplayerServer", () => ({
  getSingleplayerConfig: mocks.getSingleplayerConfig,
  setSingleplayerConfig: mocks.setSingleplayerConfig,
}));

import { PATCH } from "./route";

const request = (body: unknown) =>
  new Request("http://localhost/api/singleplayer/operator/config", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const currentConfig = {
  mode: "career",
  difficulty: "normal",
  nppAutonomyLevel: "v4",
  permanentHeadOfState: false,
  featureFlags: {
    forexEnabled: false,
    crisisAidBillsEnabled: true,
    worldEventsEnabled: true,
  },
};

describe("PATCH /api/singleplayer/operator/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSingleplayer.mockReturnValue(null);
    mocks.canOperateSingleplayerWorld.mockReturnValue(true);
    mocks.getDb.mockResolvedValue({});
    mocks.getSingleplayerConfig.mockResolvedValue({ ...currentConfig });
    mocks.setSingleplayerConfig.mockImplementation(
      async (_db: unknown, config: Record<string, unknown>) => ({
        ...config,
        configuredAt: new Date(),
      })
    );
  });

  it("merges a partial flag patch and preserves untouched config", async () => {
    const response = await PATCH(
      request({ difficulty: "hard", featureFlags: { forexEnabled: true } })
    );

    expect(response.status).toBe(200);
    expect(mocks.setSingleplayerConfig).toHaveBeenCalledOnce();
    expect(mocks.setSingleplayerConfig).toHaveBeenCalledWith(
      {},
      {
        mode: "career",
        difficulty: "hard",
        nppAutonomyLevel: "v4",
        permanentHeadOfState: false,
        featureFlags: {
          forexEnabled: true,
          crisisAidBillsEnabled: true,
          worldEventsEnabled: true,
        },
      }
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      difficulty: "hard",
      autonomyLevel: "v4",
      featureFlags: {
        forexEnabled: true,
        crisisAidBillsEnabled: true,
        worldEventsEnabled: true,
      },
    });
  });

  it("rejects unknown flag keys before writes", async () => {
    const response = await PATCH(request({ featureFlags: { godModeEnabled: true } }));

    expect(response.status).toBe(400);
    expect(mocks.setSingleplayerConfig).not.toHaveBeenCalled();
  });

  it("rejects non-boolean flag values before writes", async () => {
    const response = await PATCH(request({ featureFlags: { forexEnabled: "yes" } }));

    expect(response.status).toBe(400);
    expect(mocks.setSingleplayerConfig).not.toHaveBeenCalled();
  });

  it("rejects unknown top-level keys before writes", async () => {
    const response = await PATCH(request({ difficulty: "hard", godMode: true }));

    expect(response.status).toBe(400);
    expect(mocks.setSingleplayerConfig).not.toHaveBeenCalled();
  });

  it("rejects an empty patch", async () => {
    const response = await PATCH(request({}));

    expect(response.status).toBe(400);
    expect(mocks.setSingleplayerConfig).not.toHaveBeenCalled();
  });

  it("returns 409 when no local world is configured", async () => {
    mocks.getSingleplayerConfig.mockResolvedValueOnce(null);

    const response = await PATCH(request({ difficulty: "easy" }));

    expect(response.status).toBe(409);
    expect(mocks.setSingleplayerConfig).not.toHaveBeenCalled();
  });
});
