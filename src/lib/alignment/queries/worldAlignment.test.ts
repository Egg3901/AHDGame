import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("loadWorldAlignment", () => {
  let db: MockDb;

  const gameState = (doc: object | null) =>
    db.collection("gameState").findOne.mockResolvedValue(doc);
  const alignments = (rows: object[]) =>
    db.collection("countryAlignments").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const memberships = (rows: object[]) =>
    db.collection("organizationMemberships").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(rows),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: true });
    alignments([]);
    memberships([]);
    db.collection("alignmentCrises").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("alignmentPlays").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
  });

  it("reports the era's poles and gate", async () => {
    const { loadWorldAlignment } = await import("./worldAlignment");
    const v = await loadWorldAlignment(db as unknown as Db);
    expect(v.enabled).toBe(true);
    expect(v.eraKey).toBe("cold-war");
    expect(v.year).toBe(1953);
    expect(v.poles.map((p) => p.id)).toEqual(["WEST", "EAST"]);
    expect(v.joinGate).toBe(50);
    // Tokens, never hex — 11 themes ship with the app.
    for (const p of v.poles) expect(p.accentToken).toMatch(/^(info|error|warning|success)$/);
  });

  it("is three-pole in a modern world", async () => {
    gameState({ _id: "current", currentYear: 2019, intOrgAlignmentEnabled: true });
    const { loadWorldAlignment } = await import("./worldAlignment");
    const v = await loadWorldAlignment(db as unknown as Db);
    expect(v.poles.map((p) => p.id)).toEqual(["WASHINGTON", "MOSCOW", "BEIJING"]);
    expect(v.joinGate).toBe(40);
  });

  it("derives axis, lead and band per row", async () => {
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: null,
        turn: 0,
      },
    ]);
    const { loadWorldAlignment } = await import("./worldAlignment");
    const [row] = (await loadWorldAlignment(db as unknown as Db)).rows;
    expect(row.axis).toBe(-28);
    expect(row.lead).toBe(28);
    expect(row.status).toBe("contested");
    expect(row.topPoleId).toBe("EAST");
    expect(row.trend).toBeNull();
    expect(row.name).toBe("Yugoslavia");
  });

  it("reads trend as the change in lead, not in a share", async () => {
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: { shares: { WEST: 26, EAST: 44 }, nonAligned: 30 },
        turn: 4,
      },
    ]);
    const { loadWorldAlignment } = await import("./worldAlignment");
    const [row] = (await loadWorldAlignment(db as unknown as Db)).rows;
    expect(row.trend).toBe(10); // lead 28 now vs 18 before
  });

  it("marks a member of a pole's channel org as loyal rather than eligible", async () => {
    alignments([
      {
        entityId: "TR",
        eraKey: "cold-war",
        shares: { WEST: 60, EAST: 8 },
        nonAligned: 32,
        previous: null,
        turn: 0,
      },
    ]);
    memberships([{ organizationId: "NATO", countryId: "TR" }]);
    const { loadWorldAlignment } = await import("./worldAlignment");
    const [row] = (await loadWorldAlignment(db as unknown as Db)).rows;
    expect(row.orgIds).toContain("NATO");
    expect(row.status).toBe("loyal");
  });

  it("does not count membership of an org channelling to a DIFFERENT pole", async () => {
    alignments([
      {
        entityId: "TR",
        eraKey: "cold-war",
        shares: { WEST: 60, EAST: 8 },
        nonAligned: 32,
        previous: null,
        turn: 0,
      },
    ]);
    // Warsaw Pact channels to EAST; Turkey leads WEST, so this is not the
    // membership that makes it loyal.
    memberships([{ organizationId: "WARSAW_PACT", countryId: "TR" }]);
    const { loadWorldAlignment } = await import("./worldAlignment");
    const [row] = (await loadWorldAlignment(db as unknown as Db)).rows;
    expect(row.status).toBe("eligible");
  });

  it("is inert but not broken when the gate is off", async () => {
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: false });
    const { loadWorldAlignment } = await import("./worldAlignment");
    const v = await loadWorldAlignment(db as unknown as Db);
    expect(v.enabled).toBe(false);
    expect(v.rows).toEqual([]);
    // The collection is never read when the gate is off.
    expect(db.collectionMocks.countryAlignments?.find).not.toHaveBeenCalled();
  });

  it("carries open flashpoints with their raised movement ceiling", async () => {
    gameState({
      _id: "current",
      currentYear: 1953,
      currentTurn: 100,
      intOrgAlignmentEnabled: true,
    });
    db.collection("alignmentCrises").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: { toString: () => "c1" },
          targetEntityId: "YU",
          title: "A country pulled two ways",
          headline: "Two blocs are dug in.",
          closesTurn: 108,
          status: "open",
        },
      ]),
    });

    const { loadWorldAlignment } = await import("./worldAlignment");
    const { CRISIS_TURN_CAP, PER_NATION_TURN_CAP } = await import("@/lib/constants/alignmentEras");
    const v = await loadWorldAlignment(db as unknown as Db);

    expect(v.crises).toHaveLength(1);
    const c = v.crises[0]!;
    expect(c.targetName).toBe("Yugoslavia");
    expect(c.turnsRemaining).toBe(8);
    expect(c.movementCap).toBe(CRISIS_TURN_CAP);
    expect(c.movementCap).toBeGreaterThan(PER_NATION_TURN_CAP);
  });

  it("reports no flashpoints when the gate is off, without reading them", async () => {
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: false });
    const { loadWorldAlignment } = await import("./worldAlignment");
    const v = await loadWorldAlignment(db as unknown as Db);
    expect(v.crises).toEqual([]);
    expect(db.collection("alignmentCrises").find).not.toHaveBeenCalled();
  });
});
