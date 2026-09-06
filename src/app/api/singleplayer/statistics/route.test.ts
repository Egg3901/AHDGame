import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSingleplayer, getDb } = vi.hoisted(() => ({
  requireSingleplayer: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireSingleplayer", () => ({ requireSingleplayer }));
vi.mock("@/lib/mongodb", () => ({ getDb }));

import { ALLOWED_FEATURE_FLAGS } from "@/lib/clientStatistics";
import { GET } from "./route";

function database(state: Record<string, unknown> | null) {
  const collections: Record<string, Record<string, unknown>> = {
    gameState: { findOne: vi.fn().mockResolvedValue(state) },
    parties: { countDocuments: vi.fn().mockResolvedValue(7) },
    corporations: { countDocuments: vi.fn().mockResolvedValue(8) },
    npps: { countDocuments: vi.fn().mockResolvedValue(9) },
    corporateSectors: {
      aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ total: 10 }]) }),
    },
    electedOfficials: {
      aggregate: vi
        .fn()
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ total: 5, npp: 2 }]) }),
    },
    economicVitalSigns: { findOne: vi.fn().mockResolvedValue(null) },
  };
  return { collection: (name: string) => collections[name] };
}

describe("GET /api/singleplayer/statistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSingleplayer.mockReturnValue(null);
  });

  it("enforces the local-only guard before reading the database", async () => {
    const denied = new Response(JSON.stringify({ error: "local only" }), { status: 403 });
    requireSingleplayer.mockReturnValue(denied);

    const response = await GET(new Request("http://example.com/api/singleplayer/statistics"));

    expect(response).toBe(denied);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns every allowlisted flag, using stored config when state fields are absent", async () => {
    const state: Record<string, unknown> = {
      _id: "current",
      preset: "1953-default",
      currentTurn: 14,
      nppAutonomyLevel: "v4",
      singleplayerConfig: {
        mode: "normal",
        difficulty: "normal",
        featureFlags: { autoSectorSeedEnabled: true },
      },
      forexEnabled: false,
    };
    getDb.mockResolvedValue(database(state));

    const payload = await (
      await GET(new Request("http://127.0.0.1:3111/api/singleplayer/statistics"))
    ).json();

    expect(Object.keys(payload.setup.featureFlags).sort()).toEqual(
      [...ALLOWED_FEATURE_FLAGS].sort()
    );
    expect(payload.setup.featureFlags.forexEnabled).toBe(false);
    expect(payload.setup.featureFlags.autoSectorSeedEnabled).toBe(true);
    expect(payload.setup.featureFlags.rpgStatsEnabled).toBe(false);
  });

  it("contains aggregate setup and metrics only, with no identifiers", async () => {
    getDb.mockResolvedValue(
      database({
        _id: "current",
        preset: "2023-default",
        currentTurn: 3,
        nppAutonomyLevel: "off",
        singleplayerConfig: { mode: "worldsim", difficulty: "easy", featureFlags: {} },
      })
    );

    const payload = await (
      await GET(new Request("http://127.0.0.1:3111/api/singleplayer/statistics"))
    ).json();
    const serialized = JSON.stringify(payload);

    expect(payload.metrics).toMatchObject({ partyCount: 7, corporationCount: 8, nppCount: 9 });
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("characterId");
    expect(serialized).not.toContain("displayName");
    expect(serialized).not.toContain("email");
  });
});
