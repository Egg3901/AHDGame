import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const resolveConflict = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/military/resolveConflict", () => ({
  resolveConflict: (...args: unknown[]) => resolveConflict(...args),
}));

const admitMember = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/internationalOrganizations/joinApplication", () => ({
  admitMember: (...args: unknown[]) => admitMember(...args),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStateCollection: async (db: { collection: (n: string) => unknown }) =>
    db.collection("gameState"),
  getGameStatePresetOrDefault: async () => "1953-default",
}));

const applyConflictOutcomeAlignment = vi.fn().mockResolvedValue({ moved: 0 });
vi.mock("@/lib/alignment/commands/applyConflictOutcomeAlignment", () => ({
  applyConflictOutcomeAlignment: (...args: unknown[]) => applyConflictOutcomeAlignment(...args),
}));

const { resolveColdWarHolds, POLE_HOLD_TURNS } = await import("../coldWarHolds");

const TURN = 100;

const held = (over: Record<string, unknown> = {}) => ({
  _id: "vietnam",
  name: "Vietnam War",
  type: "cold_war",
  status: "winding_down",
  hostCountry: "SVN",
  control: 100,
  poleSide: "B",
  poleSinceTurn: TURN - POLE_HOLD_TURNS,
  sideA: { label: "RVN", countries: ["US"], kind: "generated", backer: "west" },
  sideB: { label: "DRV", countries: ["RU"], kind: "generated", backer: "east" },
  ...over,
});

describe("resolveColdWarHolds", () => {
  let db: MockDb;

  function seed(rows: unknown[], conflictsEnabled = true, intOrgAlignmentEnabled = true) {
    db = createMockDb();
    db.collection("conflicts");
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      conflictsEnabled,
      intOrgAlignmentEnabled,
      currentYear: 1955,
    });
    db.collectionMocks.conflicts.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
    // The claim succeeds by default; a test that wants to lose the race overrides it.
    db.collectionMocks.conflicts.updateOne.mockResolvedValue({ modifiedCount: 1 });
    return db;
  }

  beforeEach(() => {
    resolveConflict.mockClear();
    admitMember.mockClear();
    applyConflictOutcomeAlignment.mockClear();
  });

  it("swings the hosts toward the winning bloc, from the LIVE year", async () => {
    await resolveColdWarHolds(
      seed([held({ hostEntities: ["NVN", "SVN"] })]) as unknown as Db,
      TURN
    );

    expect(applyConflictOutcomeAlignment).toHaveBeenCalledTimes(1);
    expect(applyConflictOutcomeAlignment.mock.calls[0]![1]).toMatchObject({
      entityIds: ["NVN", "SVN"],
      bloc: "east",
      // Poles are era state — unlike the accession org, which comes from the preset.
      year: 1955,
    });
  });

  it("still admits the hosts when the alignment subsystem is off", async () => {
    // The two gates are separate: intOrgAlignmentEnabled governs the influence
    // meter, not the war. With it off the countries still change hands.
    await resolveColdWarHolds(seed([held()], true, false) as unknown as Db, TURN);

    expect(admitMember).toHaveBeenCalledTimes(1);
    expect(applyConflictOutcomeAlignment).not.toHaveBeenCalled();
  });

  it("takes EVERY host entity into the winning bloc's organisation", async () => {
    // The prize. A proxy war is not about the ground — it is about which side of the
    // board the host ends up on. Vietnam is two countries and both change hands, so
    // this reads hostEntities rather than the single map anchor.
    const withHosts = held({ hostEntities: ["NVN", "SVN"] });
    await resolveColdWarHolds(seed([withHosts]) as unknown as Db, TURN);

    expect(admitMember).toHaveBeenCalledTimes(2);
    const admitted = admitMember.mock.calls.map((c) => [c[1], c[2]]);
    // Side B holds the pole and is East-backed, so the 1953 world's eastern
    // accession org is the Warsaw Pact — never derived from the live year.
    expect(admitted).toEqual([
      ["WARSAW_PACT", "NVN"],
      ["WARSAW_PACT", "SVN"],
    ]);
  });

  it("falls back to the map anchor when no host roster is set", async () => {
    await resolveColdWarHolds(seed([held()]) as unknown as Db, TURN);

    expect(admitMember).toHaveBeenCalledTimes(1);
    expect(admitMember.mock.calls[0]![2]).toBe("SVN");
  });

  it("admits nobody when the hold has not elapsed", async () => {
    await resolveColdWarHolds(seed([held({ poleSinceTurn: TURN - 1 })]) as unknown as Db, TURN);

    expect(admitMember).not.toHaveBeenCalled();
  });

  it("resolves a conflict held at a pole for three turns", async () => {
    const res = await resolveColdWarHolds(seed([held()]) as unknown as Db, TURN);

    expect(res.resolved).toBe(1);
    expect(resolveConflict).toHaveBeenCalledTimes(1);
    // Resolves FOR the side that holds the pole.
    expect(resolveConflict.mock.calls[0]![2]).toBe("B");
  });

  it("does NOT resolve at two turns", async () => {
    const young = held({ poleSinceTurn: TURN - (POLE_HOLD_TURNS - 1) });
    // The query would not return it live; the in-loop re-check is the second guard,
    // and it is the one that matters when a battle cleared the stamp mid-tick.
    const res = await resolveColdWarHolds(seed([young]) as unknown as Db, TURN);

    expect(res.resolved).toBe(0);
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it("does NOT resolve a hold that was broken and restarted", async () => {
    // applyOccupation re-stamps poleSinceTurn on ARRIVAL at a pole, so a front pushed
    // off and retaken starts the clock again.
    const restarted = held({ poleSinceTurn: TURN - 1 });
    const res = await resolveColdWarHolds(seed([restarted]) as unknown as Db, TURN);

    expect(res.resolved).toBe(0);
  });

  it("does NOT resolve a conflict whose stamp was cleared mid-tick", async () => {
    // The front came off the pole earlier this turn: the query result is stale.
    const cleared = held({ poleSide: null, poleSinceTurn: null });
    const res = await resolveColdWarHolds(seed([cleared]) as unknown as Db, TURN);

    expect(res.resolved).toBe(0);
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it("resolves nothing when another runner already claimed the war", async () => {
    // Overlapping turn runs are a thing here (rolling deploys). Admission is
    // idempotent and resolveConflict effectively so, but the ALIGNMENT SWING is not
    // — without the claim a double run moves both hosts twice.
    const db2 = seed([held()]);
    db2.collectionMocks.conflicts.updateOne.mockResolvedValue({ modifiedCount: 0 });

    const res = await resolveColdWarHolds(db2 as unknown as Db, TURN);

    expect(res.resolved).toBe(0);
    expect(resolveConflict).not.toHaveBeenCalled();
    expect(admitMember).not.toHaveBeenCalled();
    expect(applyConflictOutcomeAlignment).not.toHaveBeenCalled();
  });

  it("reads conflictsEnabled at the step itself", async () => {
    // The FIRST conflict turn-step with no upstream gate: it is reached from
    // poleSinceTurn alone, with no declaration upstream of it to have been refused.
    const res = await resolveColdWarHolds(seed([held()], false) as unknown as Db, TURN);

    expect(res.resolved).toBe(0);
    expect(resolveConflict).not.toHaveBeenCalled();
  });
});
