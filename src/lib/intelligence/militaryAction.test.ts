import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { SABOTAGE_READINESS_POINTS, SABOTAGE_SUPPLY_POINTS, SABOTAGE_UNIT_COUNT } from "./config";
import { degradedReadiness, sabotagedSupplyBase } from "./militaryAction";

const state = {
  conflicts: [] as Record<string, unknown>[],
  units: [] as Record<string, unknown>[],
  conflictWrites: [] as Record<string, unknown>[],
  unitWrites: [] as Record<string, unknown>[],
};

vi.mock("@/lib/db/collections/conflicts", () => ({
  listActiveConflicts: async () => state.conflicts,
  getConflictsCollection: () => ({
    updateOne: async (_f: unknown, u: Record<string, unknown>) => {
      state.conflictWrites.push(u);
    },
  }),
}));
vi.mock("@/lib/db/collections/militaryUnits", () => ({
  getMilitaryUnitsCollection: () => ({
    find: () => ({
      sort: () => ({ limit: () => ({ toArray: async () => state.units }) }),
    }),
    updateOne: async (_f: unknown, u: Record<string, unknown>) => {
      state.unitWrites.push(u);
    },
  }),
}));

const db = {} as Db;

function conflict(over: Record<string, unknown> = {}) {
  return {
    _id: "war1",
    sideA: { countries: ["US"] },
    sideB: { countries: ["DD"] },
    supplyA: 70,
    supplyB: 60,
    supplyBaseA: 72,
    supplyBaseB: 64,
    ...over,
  };
}

function reset() {
  state.conflicts = [conflict()];
  state.units = [
    { _id: "u1", readiness: 90 },
    { _id: "u2", readiness: 80 },
  ];
  state.conflictWrites = [];
  state.unitWrites = [];
}

describe("sabotagedSupplyBase", () => {
  it("takes the configured points off the base", () => {
    expect(sabotagedSupplyBase(64)).toBe(64 - SABOTAGE_SUPPLY_POINTS);
  });

  it("never drives supply below zero", () => {
    expect(sabotagedSupplyBase(2)).toBe(0);
  });

  it("never exceeds the ceiling", () => {
    expect(sabotagedSupplyBase(500)).toBeLessThanOrEqual(100);
  });

  it("survives a non-finite base", () => {
    expect(sabotagedSupplyBase(Number.NaN)).toBe(0);
  });
});

describe("degradedReadiness", () => {
  it("takes the configured points off", () => {
    expect(degradedReadiness(90)).toBe(90 - SABOTAGE_READINESS_POINTS);
  });

  it("floors at zero", () => {
    expect(degradedReadiness(3)).toBe(0);
  });
});

describe("applyMilitaryAction", () => {
  it("writes the seeded BASE, never the derived reading", async () => {
    // occupation.derivedSupplies recomputes supplyA/supplyB from the bases every
    // read, so writing the derived value would be erased on the next pass.
    reset();
    const { applyMilitaryAction } = await import("./militaryAction");
    await applyMilitaryAction(db, "DD");
    const write = state.conflictWrites[0].$set as Record<string, unknown>;
    expect(write).toHaveProperty("supplyBaseB");
    expect(write).not.toHaveProperty("supplyB");
    expect(write.supplyBaseB).toBe(64 - SABOTAGE_SUPPLY_POINTS);
  });

  it("hits the target's own side, not the other one", async () => {
    reset();
    const { applyMilitaryAction } = await import("./militaryAction");
    await applyMilitaryAction(db, "US");
    const write = state.conflictWrites[0].$set as Record<string, unknown>;
    expect(write).toHaveProperty("supplyBaseA");
  });

  it("falls back to the live reading on a conflict that predates the bases", async () => {
    reset();
    state.conflicts = [conflict({ supplyBaseB: undefined })];
    const { applyMilitaryAction } = await import("./militaryAction");
    await applyMilitaryAction(db, "DD");
    const write = state.conflictWrites[0].$set as Record<string, unknown>;
    expect(write.supplyBaseB).toBe(60 - SABOTAGE_SUPPLY_POINTS);
  });

  it("degrades readiness on the formations it reached", async () => {
    reset();
    const { applyMilitaryAction } = await import("./militaryAction");
    const r = await applyMilitaryAction(db, "DD");
    expect(r.formationsDegraded).toBe(2);
    expect((state.unitWrites[0].$set as Record<string, number>).readiness).toBe(
      90 - SABOTAGE_READINESS_POINTS
    );
  });

  it("touches only ONE front, not every war the target is fighting", async () => {
    reset();
    state.conflicts = [conflict(), conflict({ _id: "war2" })];
    const { applyMilitaryAction } = await import("./militaryAction");
    const r = await applyMilitaryAction(db, "DD");
    expect(state.conflictWrites).toHaveLength(1);
    expect(r.frontSabotaged).toBe("war1");
  });

  it("still degrades readiness for a country at peace", async () => {
    reset();
    state.conflicts = [];
    const { applyMilitaryAction } = await import("./militaryAction");
    const r = await applyMilitaryAction(db, "DD");
    expect(r.frontSabotaged).toBeNull();
    expect(r.formationsDegraded).toBe(2);
  });

  it("reports nothing done against a country with no army and no war", async () => {
    reset();
    state.conflicts = [];
    state.units = [];
    const { applyMilitaryAction } = await import("./militaryAction");
    expect(await applyMilitaryAction(db, "DD")).toEqual({
      frontSabotaged: null,
      formationsDegraded: 0,
    });
  });

  it("caps how many formations one operation can reach", () => {
    expect(SABOTAGE_UNIT_COUNT).toBeLessThanOrEqual(10);
  });
});
