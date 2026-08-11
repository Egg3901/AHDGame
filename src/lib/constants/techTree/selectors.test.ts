import { describe, it, expect } from "vitest";
import { getResearchableDecades, getDecadeForYear, TECH_DECADES } from "./decades";
import { TECH_TREE, corpNodeId, sectorNodeId } from "./nodes";
import { techNodeCashCost } from "./costs";
import {
  canUnlock,
  getCommittedLane,
  getActiveTechEffects,
  getAggregatedTechEffects,
  getUnlockedStrategyIds,
  autoGrantedNodeIds,
  getDecadeLaneNodes,
  getNodePrereqId,
  getSectorTechEffects,
  SLOT_PARENT,
  type TechCorpView,
} from "./selectors";

const FUNDS = { rdScore: 999, cashAvailable: 1e12, cashCost: 0 };

describe("decades", () => {
  it("returns current decade onward as researchable", () => {
    expect(getResearchableDecades(2020).map((d) => d.id)).toEqual(["2019", "2029"]);
    expect(getDecadeForYear(1995).id).toBe("1989");
  });
});

describe("tree shape (v2 lanes)", () => {
  it("gives every sector 9 corporate nodes per decade", () => {
    for (const decade of TECH_DECADES) {
      const count = getDecadeLaneNodes("retail", decade.id, "generic").length;
      expect(count, `retail corporate ${decade.id}`).toBe(9);
    }
  });
  it("authors a full sector lane for every decade", () => {
    for (const decade of TECH_DECADES) {
      const count = getDecadeLaneNodes("energy", decade.id, "sector").length;
      expect(count, `energy sector ${decade.id}`).toBe(9);
    }
  });
  it("every sector now has an authored sector lane", () => {
    expect(TECH_TREE.retail.some((n) => n.lane === "sector")).toBe(true);
  });
  it("early manufacturing sector keeps both fork sides (ticket-1016)", () => {
    const slots = getDecadeLaneNodes("manufacturing", "1950", "sector").map((n) => n.slot);
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("autoGrantedNodeIds", () => {
  it("grants both generic and sector nodes for all passed decades", () => {
    const ids = autoGrantedNodeIds("energy", 2020); // current decade 2019 → 1940..2009 passed
    expect(ids).toContain(corpNodeId("1940", 1));
    expect(ids).toContain(corpNodeId("1979", 1));
    expect(ids).toContain(corpNodeId("2009", 9));
    expect(ids).toContain(sectorNodeId("energy", "1979", 1));
    expect(ids).not.toContain(corpNodeId("2019", 1));
    expect(ids).not.toContain(sectorNodeId("energy", "2019", 1));
    // 4 early decades × (9 generic + 9 sector) + 4 playable past × (9 + 9) = 72 + 72 = 144
    expect(ids).toHaveLength(144);
  });
  it("grants nothing for the earliest era", () => {
    expect(autoGrantedNodeIds("energy", 1942)).toHaveLength(0); // 1940 is current, nothing passed
  });
});

describe("canUnlock (v2)", () => {
  const corp: TechCorpView = { type: "energy", unlockedTechNodeIds: [] };

  it("allows a reached, affordable node", () => {
    expect(canUnlock(corp, corpNodeId("2019", 1), 2020, FUNDS).ok).toBe(true);
  });
  it("blocks a future decade", () => {
    expect(canUnlock(corp, corpNodeId("2029", 1), 2020, FUNDS)).toMatchObject({
      ok: false,
      reason: "decade-locked",
    });
  });
  it("blocks the other lane once committed", () => {
    const committed: TechCorpView = {
      type: "energy",
      unlockedTechNodeIds: [sectorNodeId("energy", "2019", 1)],
      techDecadeLane: { "2019": "sector" },
    };
    expect(canUnlock(committed, corpNodeId("2019", 1), 2020, FUNDS)).toMatchObject({
      ok: false,
      reason: "lane-locked",
    });
  });
  it("allows more nodes within the committed lane", () => {
    const committed: TechCorpView = {
      type: "energy",
      unlockedTechNodeIds: [sectorNodeId("energy", "2019", 1)],
      techDecadeLane: { "2019": "sector" },
    };
    expect(canUnlock(committed, sectorNodeId("energy", "2019", 2), 2020, FUNDS).ok).toBe(true);
  });
  it("blocks an already-owned node", () => {
    const owned: TechCorpView = {
      type: "energy",
      unlockedTechNodeIds: [corpNodeId("2019", 1)],
      techDecadeLane: { "2019": "generic" },
    };
    expect(canUnlock(owned, corpNodeId("2019", 1), 2020, FUNDS)).toMatchObject({
      ok: false,
      reason: "already-owned",
    });
  });
  it("blocks on insufficient rdScore", () => {
    expect(canUnlock(corp, corpNodeId("2019", 1), 2020, { ...FUNDS, rdScore: 0 })).toMatchObject({
      ok: false,
      reason: "insufficient-rd",
    });
  });
  it("blocks on insufficient cash", () => {
    expect(
      canUnlock(corp, corpNodeId("2019", 1), 2020, {
        rdScore: 999,
        cashAvailable: 10,
        cashCost: 100,
      })
    ).toMatchObject({ ok: false, reason: "insufficient-cash" });
  });
  it("blocks an unknown node", () => {
    expect(canUnlock(corp, "not-real", 2020, FUNDS)).toMatchObject({
      ok: false,
      reason: "unknown-node",
    });
  });

  it("enforces tree order — a child needs its parent first", () => {
    // slot 2 needs slot 1; slot 4 needs slot 2.
    const committed: TechCorpView = {
      type: "energy",
      unlockedTechNodeIds: [corpNodeId("2019", 1)],
      techDecadeLane: { "2019": "generic" },
    };
    expect(canUnlock(committed, corpNodeId("2019", 2), 2020, FUNDS).ok).toBe(true);
    expect(canUnlock(committed, corpNodeId("2019", 4), 2020, FUNDS)).toMatchObject({
      ok: false,
      reason: "prereq-missing",
    });
  });

  it("maps slot topology to the right parent node id", () => {
    expect(SLOT_PARENT[1]).toBeNull();
    expect(getNodePrereqId(TECH_TREE.energy.find((n) => n.id === corpNodeId("2019", 4))!)).toBe(
      corpNodeId("2019", 2)
    );
    expect(
      getNodePrereqId(TECH_TREE.energy.find((n) => n.id === corpNodeId("2019", 1))!)
    ).toBeNull();
  });
});

describe("committed lane + effects", () => {
  it("infers committed lane from unlocked nodes when map absent", () => {
    const corp: TechCorpView = { type: "energy", unlockedTechNodeIds: [corpNodeId("1999", 3)] };
    expect(getCommittedLane(corp, "1999")).toBe("generic");
    expect(getCommittedLane(corp, "2009")).toBeUndefined();
  });
  it("aggregates margin effects from unlocked nodes", () => {
    const corp: TechCorpView = { type: "energy", unlockedTechNodeIds: [corpNodeId("2019", 1)] };
    expect(getActiveTechEffects(corp).length).toBeGreaterThan(0);
    expect(getAggregatedTechEffects(corp).marginBonusPp).toBeCloseTo(2); // RPA = +2pp
  });
  it("surfaces unlocked production methods", () => {
    const corp: TechCorpView = {
      type: "energy",
      unlockedTechNodeIds: [sectorNodeId("energy", "1979", 5)], // Nuclear Program
    };
    expect(getUnlockedStrategyIds(corp)).toContain("nuclear");
  });

  it("scopes effects: sector lane = primary only (full), corp lane = all (halved)", () => {
    // energy-2019-1 (sector, +3.5pp) + corp-2019-1 (generic, +2pp).
    const corp: TechCorpView = {
      type: "energy",
      unlockedTechNodeIds: [sectorNodeId("energy", "2019", 1), corpNodeId("2019", 1)],
    };
    // Primary (energy) sector: corp 2×0.5=1 + sector 3.5 = 4.5pp.
    expect(getSectorTechEffects(corp, "energy").marginBonusPp).toBeCloseTo(4.5);
    // A non-primary sector: only the corp lane, halved → 1pp; no sector bonus.
    expect(getSectorTechEffects(corp, "retail").marginBonusPp).toBeCloseTo(1);
  });
});

describe("cash cost", () => {
  it("scales with daily gross revenue and the node fraction", () => {
    const node = TECH_TREE.energy.find((n) => n.id === corpNodeId("2019", 1))!;
    expect(techNodeCashCost(node, 100_000)).toBe(25_000); // default 0.25
    expect(techNodeCashCost(node, 0)).toBe(0);
  });
});
