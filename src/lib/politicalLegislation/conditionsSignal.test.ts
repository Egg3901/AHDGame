import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { NPP, LegislationType } from "@/lib/db/types";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { selectNppBill } from "@/lib/nppAutonomy/selectNppBill";
import {
  WEAK_DOMAIN_THRESHOLD,
  STRONG_DOMAIN_THRESHOLD,
  loadPoliticalConditionsDomains,
  politicalWeakDomains,
  politicalStrongDomains,
} from "./conditionsSignal";

function board(overrides: Partial<Record<PoliticalMetricId, number>> = {}) {
  const out = {} as Record<PoliticalMetricId, number>;
  for (const f of POLITICAL_METRIC_FAMILIES) out[f.id] = overrides[f.id] ?? 50;
  return out;
}

function weakOrderBoard(orderValue: number) {
  const values = board();
  for (const f of POLITICAL_METRIC_FAMILIES) {
    if (f.categoryId === "order") values[f.id] = orderValue;
  }
  return values;
}

function categoryBoard(categoryId: string, value: number) {
  const values = board();
  for (const f of POLITICAL_METRIC_FAMILIES) {
    if (f.categoryId === categoryId) values[f.id] = value;
  }
  return values;
}

/** Multiple category overrides on ONE base board (spreading two full boards
 * together would have the second board's untouched-category baseline of 50
 * clobber the first board's override for that category). */
function multiCategoryBoard(overrides: Record<string, number>) {
  const values = board();
  for (const f of POLITICAL_METRIC_FAMILIES) {
    if (f.categoryId in overrides) values[f.id] = overrides[f.categoryId];
  }
  return values;
}

describe("politicalWeakDomains (spec §3/§6)", () => {
  it("maps a weak Public Order category to lowercased 'publicsafety'", () => {
    expect(politicalWeakDomains(weakOrderBoard(30))).toEqual({ publicsafety: 0.25 });
  });

  it("an all-50 board (Strained but not Weak) yields no weak domains", () => {
    expect(politicalWeakDomains(board())).toEqual({});
    expect(WEAK_DOMAIN_THRESHOLD).toBe(40);
  });

  it("emits only lowercase keys across a fully-critical board", () => {
    const weak = politicalWeakDomains(
      board(
        Object.fromEntries(POLITICAL_METRIC_FAMILIES.map((f) => [f.id, 10])) as Partial<
          Record<PoliticalMetricId, number>
        >
      )
    );
    expect(Object.keys(weak).length).toBeGreaterThan(0);
    for (const key of Object.keys(weak)) expect(key).toBe(key.toLowerCase());
  });

  it("drives NPP urgency end to end: a publicSafety-domain type wins on a weak-order board", () => {
    const npp = {
      _id: new ObjectId(),
      policies: { economic: 0, social: 0 },
    } as unknown as NPP;
    const makeType = (id: string, domain: string): LegislationType =>
      ({
        _id: id,
        name: id,
        description: id,
        policyDomain: domain,
        subCategory: "t",
        positions: [],
        policyOptions: [
          {
            id: `${id}_o`,
            name: "O",
            stance: "center",
            effectDirection: 0,
            economic: 0,
            social: 0,
          },
        ],
        countryScope: "us",
      }) as unknown as LegislationType;
    const signal = { inflationRate: 0, weakDomains: politicalWeakDomains(weakOrderBoard(30)) };
    const result = selectNppBill(
      [makeType("aaa_neutral", "social"), makeType("zzz_safety", "publicSafety")],
      npp,
      signal
    );
    // Equal platform fit; urgency 0.25 on "publicsafety" must break the tie in
    // favor of the safety type despite its higher (tie-losing) _id.
    expect(result).not.toBeNull();
    expect(result!.legType._id).toBe("zzz_safety");
  });
});

describe("politicalStrongDomains (mirror of politicalWeakDomains, drives agenda 'lower')", () => {
  it("maps a comfortably-strong Defense category to 'defense' with a comfort score", () => {
    // 87.5 is halfway between the 75 threshold and 100 → comfort 0.5.
    expect(politicalStrongDomains(categoryBoard("defense", 87.5))).toEqual({ defense: 0.5 });
    expect(STRONG_DOMAIN_THRESHOLD).toBe(75);
  });

  it("an all-50 board (comfortable Strained, not Strong) yields no strong domains", () => {
    expect(politicalStrongDomains(board())).toEqual({});
  });

  it("a maxed (100) category yields comfort 1.0", () => {
    expect(politicalStrongDomains(categoryBoard("health", 100))).toEqual({ healthcare: 1.0 });
  });

  it("weak and strong are mutually exclusive on the same board", () => {
    const mixed = multiCategoryBoard({ order: 20, defense: 90 });
    expect(politicalWeakDomains(mixed)).toEqual({ publicsafety: 0.5 });
    expect(politicalStrongDomains(mixed)).toEqual({ defense: 0.6 });
  });
});

describe("loadPoliticalConditionsDomains", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("returns null when the country has no politicalMetrics docs", async () => {
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    db.collection("states").find().toArray.mockResolvedValue([]);
    expect(await loadPoliticalConditionsDomains(db as unknown as Db, "US")).toBeNull();
  });

  it("reads weak and strong off a single national-board fetch (RU/DD frozen-surplus fix)", async () => {
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "A", countryId: "DD", values: multiCategoryBoard({ order: 20, health: 95 }) },
      ]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "A", countryId: "DD", population: 1 }]);
    const domains = await loadPoliticalConditionsDomains(db as unknown as Db, "DD");
    expect(domains).not.toBeNull();
    expect(domains!.weak).toEqual({ publicsafety: 0.5 });
    expect(domains!.strong).toEqual({ healthcare: 0.8 });
  });
});

describe("politicalDomainHealth (governing-agenda health map)", () => {
  it("emits the METRIC_TO_DOMAIN political vocabulary from category scores", async () => {
    const { politicalDomainHealth } = await import("./conditionsSignal");
    const health = politicalDomainHealth(weakOrderBoard(30));
    expect(health.public_safety).toBeCloseTo(30, 9);
    expect(health.education).toBeCloseTo(50, 9);
    expect(health.workforce).toBeCloseTo(50, 9);
    // Economic domains are NOT emitted — they stay on the surviving legacy read.
    expect("employment" in health).toBe(false);
    expect("economic_growth" in health).toBe(false);
  });

  it("loadDomainHealth overlays political health for playables and keeps economic rows", async () => {
    const { loadDomainHealth } = await import("@/lib/nppAutonomy/governingMetrics");
    const db = createMockDb();
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([{ _id: "MI", countryId: "US", values: weakOrderBoard(30) }]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "MI", countryId: "US", population: 1 }]);
    // Surviving national economic values feed the legacy economic domains —
    // SP5: they live on macroMetrics now.
    db.collection("macroMetrics").findOne.mockResolvedValue({
      economic: { unemploymentRate: { value: 4 }, gdpGrowth: { value: 2 } },
    });
    const health = await loadDomainHealth(db as unknown as Db, "US");
    expect(health.public_safety).toBeCloseTo(30, 9);
    expect(health.employment).toBe(4);
    expect(health.economic_growth).toBe(2);
  });
});

describe("loadPoliticalConditionsDomains (weak-domain path)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("returns null when the country has no politicalMetrics docs", async () => {
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    db.collection("states").find().toArray.mockResolvedValue([]);
    expect(await loadPoliticalConditionsDomains(db as unknown as Db, "US")).toBeNull();
  });

  it("aggregates regions by population before scoring weakness", async () => {
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "A", countryId: "US", values: weakOrderBoard(20) },
        { _id: "B", countryId: "US", values: weakOrderBoard(60) },
      ]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        { _id: "A", countryId: "US", population: 3_000_000 },
        { _id: "B", countryId: "US", population: 1_000_000 },
      ]);
    // Weighted order score = (20*3 + 60*1) / 4 = 30 → urgency 0.25.
    const conditions = await loadPoliticalConditionsDomains(db as unknown as Db, "US");
    expect(conditions?.weak).toEqual({ publicsafety: 0.25 });
  });
});
