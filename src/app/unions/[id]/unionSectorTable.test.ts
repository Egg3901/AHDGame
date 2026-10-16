import { describe, expect, it } from "vitest";
import type { SectorRow } from "./unionTypes";
import {
  EMPTY_SECTOR_FILTER,
  filterSectors,
  quoteBatch,
  sectorDriveCost,
  sectorStatus,
  sortSectors,
} from "./unionSectorTable";

function row(overrides: Partial<SectorRow>): SectorRow {
  return {
    sectorId: "s",
    corporationId: "c",
    corporationName: "Acme",
    stateId: "TX",
    wageLevel: 1,
    workers: 1000,
    wageGap: null,
    unionization: 10,
    representingUnionId: null,
    strikeActive: false,
    strikeCooldownUntilTurn: null,
    strikeBlockReason: null,
    ...overrides,
  };
}

const rows = [
  row({ sectorId: "a", corporationName: "Bravo", stateId: "PA", workers: 500, wageGap: 0.1 }),
  row({
    sectorId: "b",
    corporationName: "alpha",
    stateId: "OH",
    workers: 4000,
    representingUnionId: "u1",
    unionization: 60,
    strikeBlockReason: "collective_agreement",
  }),
  row({
    sectorId: "c",
    corporationName: "Charlie",
    stateId: "TX",
    workers: 2000,
    representingUnionId: "u2",
    strikeActive: true,
  }),
];

describe("sectorStatus", () => {
  it("keeps the Status column's precedence: an active strike wins over any block reason", () => {
    expect(sectorStatus(row({ strikeActive: true, strikeBlockReason: "underorganized" }))).toBe(
      "striking"
    );
    expect(sectorStatus(row({ strikeBlockReason: "sector_cooldown" }))).toBe("cooldown");
    expect(sectorStatus(row({}))).toBe("ready");
  });
});

describe("filterSectors", () => {
  it("matches corporation or state, case-insensitively", () => {
    expect(filterSectors(rows, { ...EMPTY_SECTOR_FILTER, text: "ALP" }, "u1")).toHaveLength(1);
    expect(filterSectors(rows, { ...EMPTY_SECTOR_FILTER, text: "tx" }, "u1")[0].sectorId).toBe("c");
  });

  it("filters by strike status and by who holds the shop", () => {
    expect(
      filterSectors(rows, { ...EMPTY_SECTOR_FILTER, status: "agreement" }, "u1").map(
        (s) => s.sectorId
      )
    ).toEqual(["b"]);
    expect(
      filterSectors(rows, { ...EMPTY_SECTOR_FILTER, holding: "rival" }, "u1").map((s) => s.sectorId)
    ).toEqual(["c"]);
    expect(
      filterSectors(rows, { ...EMPTY_SECTOR_FILTER, holding: "none" }, "u1").map((s) => s.sectorId)
    ).toEqual(["a"]);
  });
});

describe("sortSectors", () => {
  it("leaves the server order alone until a column is picked", () => {
    expect(sortSectors(rows, null, "asc", "u1")).toBe(rows);
  });

  it("sorts text without regard to case and numbers by value", () => {
    expect(sortSectors(rows, "corporation", "asc", "u1").map((s) => s.sectorId)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(sortSectors(rows, "workers", "desc", "u1").map((s) => s.sectorId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sinks shops with no wage claim gap in both directions", () => {
    expect(sortSectors(rows, "gap", "desc", "u1")[0].sectorId).toBe("a");
    expect(sortSectors(rows, "gap", "asc", "u1")[0].sectorId).toBe("a");
  });

  it("sorts by the same drive price the server charges", () => {
    const sorted = sortSectors(rows, "cost", "asc", "u1");
    const costs = sorted.map((s) => sectorDriveCost(s, "u1"));
    expect(costs).toEqual([...costs].sort((x, y) => x - y));
  });
});

describe("quoteBatch", () => {
  it("adds up action points and treasury", () => {
    const q = quoteBatch(rows, "u1", 1_000_000, 10);
    expect(q.actionPoints).toBe(3);
    expect(q.treasury).toBe(rows.reduce((sum, s) => sum + sectorDriveCost(s, "u1"), 0));
    expect(q.blocker).toBeNull();
  });

  it("says why a batch cannot run", () => {
    expect(quoteBatch(rows, "u1", 1_000_000, 2).blocker).toMatch(/needs 3 action points/i);
    expect(quoteBatch(rows, "u1", 10, 10).blocker).toMatch(/from the treasury/i);
  });

  it("does not block on an action balance that has not loaded", () => {
    expect(quoteBatch(rows, "u1", 1_000_000, null).blocker).toBeNull();
  });
});
