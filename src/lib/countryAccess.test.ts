import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

let db: MockDb;

async function setupDb() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  // Pre-initialize the collection so collectionMocks entries exist
  db.collection("countryGameStates");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

// ---------------------------------------------------------------------------
// getCountryAccess
// ---------------------------------------------------------------------------
describe("getCountryAccess()", () => {
  it("returns DB values when full document exists", async () => {
    await setupDb();
    // UK document with status 'beta' and enabledForPlayers: false
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "UK",
      enabledForPlayers: false,
      status: "beta",
    });

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("UK");

    expect(result).toEqual({
      enabledForPlayers: false,
      status: "beta",
      economyPreview: false,
      registered: true,
      econOnly: true,
      nppGoverned: false,
    });
  });

  it("falls back to config when no document exists (US — active)", async () => {
    await setupDb();
    // US config has status: "active" → enabledForPlayers should be true
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue(null);

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("US");

    expect(result).toEqual({
      enabledForPlayers: true,
      status: "active",
      economyPreview: false,
      registered: true,
      econOnly: false,
      nppGoverned: false,
    });
  });

  it("falls back to config when no document exists (JP — active)", async () => {
    await setupDb();
    // JP config has status: "active" → enabledForPlayers should be true
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue(null);

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("JP");

    expect(result).toEqual({
      enabledForPlayers: true,
      status: "active",
      economyPreview: false,
      registered: true,
      econOnly: false,
      nppGoverned: false,
    });
  });

  it("per-field fallback: only status in doc → enabledForPlayers derived from resolvedStatus", async () => {
    await setupDb();
    // Document only has status; enabledForPlayers absent → derived as false from "coming-soon"
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "UK",
      status: "coming-soon",
    });

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("UK");

    expect(result).toEqual({
      enabledForPlayers: false,
      status: "coming-soon",
      economyPreview: false,
      registered: true,
      econOnly: true,
      nppGoverned: false,
    });
  });

  it("per-field fallback: only enabledForPlayers in doc → status falls back to config", async () => {
    await setupDb();
    // UK config has status: "active"; document only overrides enabledForPlayers
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "UK",
      enabledForPlayers: true,
    });

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("UK");

    // UK config status is "active"
    expect(result).toEqual({
      enabledForPlayers: true,
      status: "active",
      economyPreview: false,
      registered: true,
      econOnly: false,
      nppGoverned: false,
    });
  });

  it("marks a disabled country nppGoverned when global NPP autonomy is v1+", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "UK",
      status: "coming-soon",
    });
    // Global autonomy level v1 → the governing brain runs in non-player countries.
    db.collection("gameState").findOne.mockResolvedValue({ nppAutonomyLevel: "v1" });

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("UK");

    expect(result.enabledForPlayers).toBe(false);
    expect(result.nppGoverned).toBe(true);
  });

  it("does NOT mark a player-enabled country nppGoverned even at v1", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue(null); // US active
    db.collection("gameState").findOne.mockResolvedValue({ nppAutonomyLevel: "v1" });

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("US");

    expect(result.enabledForPlayers).toBe(true);
    expect(result.nppGoverned).toBe(false);
  });

  it("marks a registered but disabled country econOnly, independent of NPP autonomy", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "UK",
      status: "coming-soon",
    });
    // Autonomy OFF. Browsability must not ride on the autonomy dial — turning it
    // down should never silently re-close half the world.
    db.collection("gameState").findOne.mockResolvedValue({ nppAutonomyLevel: "off" });

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("UK");

    expect(result.enabledForPlayers).toBe(false);
    expect(result.nppGoverned).toBe(false);
    expect(result.registered).toBe(true);
    expect(result.econOnly).toBe(true);
  });

  it("never marks a player-enabled country econOnly", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue(null); // US active

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("US");

    expect(result.enabledForPlayers).toBe(true);
    expect(result.econOnly).toBe(false);
  });

  it("leaves an unactivated latent country (SCO) unregistered and not econOnly", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue(null);

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("SCO");

    expect(result.registered).toBe(false);
    expect(result.econOnly).toBe(false);
  });

  it("registers a latent country once its row flips to active", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "SCO",
      status: "active",
    });

    const { getCountryAccess } = await import("./countryAccess");
    const result = await getCountryAccess("SCO");

    expect(result.registered).toBe(true);
  });

  it("throws on invalid countryId", async () => {
    await setupDb();

    const { getCountryAccess } = await import("./countryAccess");

    await expect(
      // @ts-expect-error — intentionally passing invalid countryId
      getCountryAccess("XX")
    ).rejects.toThrow("Invalid country ID: XX");
  });
});

// ---------------------------------------------------------------------------
// getEnabledCountryIds
// ---------------------------------------------------------------------------
describe("getEnabledCountryIds()", () => {
  it("fresh deploy (no documents) → returns active countries from config", async () => {
    await setupDb();
    // No docs in DB; US, UK, JP, DE, IE, and CN have status "active" in config
    db.collectionMocks["countryGameStates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as any);

    const { getEnabledCountryIds } = await import("./countryAccess");
    const result = await getEnabledCountryIds();

    expect(result).toEqual(["US", "UK", "JP", "DE", "IE", "CN"]);
  });

  it("returns only enabled countries from DB docs", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "US", enabledForPlayers: true, status: "active" },
        { _id: "UK", enabledForPlayers: false, status: "active" },
      ]),
    } as any);

    const { getEnabledCountryIds } = await import("./countryAccess");
    const result = await getEnabledCountryIds();

    // US enabled, UK disabled via DB; JP, DE, IE, and CN active in config (no DB override)
    expect(result).toEqual(["US", "JP", "DE", "IE", "CN"]);
  });

  it("uses a single find() call, not N findOne() calls", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as any);

    const { getEnabledCountryIds } = await import("./countryAccess");
    await getEnabledCountryIds();

    expect(db.collectionMocks["countryGameStates"]!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["countryGameStates"]!.findOne).not.toHaveBeenCalled();
  });

  it("includes an activated latent country (SCO) beyond COUNTRY_ORDER", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "SCO", enabledForPlayers: true, status: "active" }]),
    } as any);

    const { getEnabledCountryIds } = await import("./countryAccess");
    const result = await getEnabledCountryIds();

    expect(result).toContain("SCO");
  });
});

// ---------------------------------------------------------------------------
// getEnabledCountryIdsFromDb (Db-injecting variant — used by per-turn phases)
// ---------------------------------------------------------------------------
describe("getEnabledCountryIdsFromDb()", () => {
  it("includes the US (config-active, no countryGameStates doc) and excludes coming-soon", async () => {
    db.collection("countryGameStates");
    // Empty collection: every country resolves against its config default.
    db.collectionMocks["countryGameStates"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as any);

    const { getEnabledCountryIdsFromDb } = await import("./countryAccess");
    const result = await getEnabledCountryIdsFromDb(db as unknown as Db);

    // Regression for the auto-disaster spawner: the US must be enumerated even
    // though it has no countryGameStates document (it lives on global gameState).
    expect(result).toContain("US");
    // BR is "coming-soon" in config with no DB override → not enabled.
    expect(result).not.toContain("BR");
  });
});

// ---------------------------------------------------------------------------
// isCountryAccessible
// ---------------------------------------------------------------------------
describe("isCountryAccessible()", () => {
  it("returns true for admins regardless of enabled state", async () => {
    await setupDb();

    const { isCountryAccessible } = await import("./countryAccess");
    const result = await isCountryAccessible("UK", true);

    expect(result).toBe(true);
    // Should not query DB — admin short-circuits before getCountryAccess
    expect(db.collectionMocks["countryGameStates"]!.findOne).not.toHaveBeenCalled();
  });

  it("returns true for non-admins when country is enabled", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "US",
      enabledForPlayers: true,
      status: "active",
    });

    const { isCountryAccessible } = await import("./countryAccess");
    const result = await isCountryAccessible("US", false);

    expect(result).toBe(true);
  });

  it("returns false for non-admins when country is disabled", async () => {
    await setupDb();
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "DE",
      enabledForPlayers: false,
      status: "coming-soon",
    });

    const { isCountryAccessible } = await import("./countryAccess");
    const result = await isCountryAccessible("DE", false);

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isCountryEnabledForPlayers — boolean helper used by Phase 10 allowlist gates
// ---------------------------------------------------------------------------
describe("isCountryEnabledForPlayers()", () => {
  it("returns true when no override doc exists and config status is 'active'", async () => {
    db.collection("countryGameStates");
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue(null);
    // US is status:"active" in static config
    const { isCountryEnabledForPlayers } = await import("./countryAccess");
    await expect(isCountryEnabledForPlayers(db as unknown as Db, "US")).resolves.toBe(true);
  });

  it("returns false when no override doc exists and config status is 'coming-soon'", async () => {
    db.collection("countryGameStates");
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue(null);
    // BR is status:"coming-soon" in static config (roadmap country, not yet activated)
    const { isCountryEnabledForPlayers } = await import("./countryAccess");
    await expect(isCountryEnabledForPlayers(db as unknown as Db, "BR")).resolves.toBe(false);
  });

  it("returns true when a DB override flips a coming-soon country on", async () => {
    db.collection("countryGameStates");
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "BR",
      enabledForPlayers: true,
      status: "active",
    });
    const { isCountryEnabledForPlayers } = await import("./countryAccess");
    await expect(isCountryEnabledForPlayers(db as unknown as Db, "BR")).resolves.toBe(true);
  });

  it("returns false when a DB override disables an active country", async () => {
    db.collection("countryGameStates");
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: "US",
      enabledForPlayers: false,
    });
    const { isCountryEnabledForPlayers } = await import("./countryAccess");
    await expect(isCountryEnabledForPlayers(db as unknown as Db, "US")).resolves.toBe(false);
  });
});
