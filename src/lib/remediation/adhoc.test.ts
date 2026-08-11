import { describe, it, expect } from "vitest";
import { makeStrictInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import { adhocId, compileAdhocDefect, validateAdhocSpec } from "./adhoc";
import { runApply, runPlan } from "./runner";
import type { AdhocSpec } from "./types";

function makeSpec(overrides: Partial<AdhocSpec> = {}): AdhocSpec {
  return {
    description: "clear the stuck flag on three campaign rows for ticket 1234",
    collection: "campaigns",
    filter: { stuck: true },
    action: { kind: "set", set: { stuck: false } },
    expectedMax: 10,
    ...overrides,
  };
}

function problemFields(spec: AdhocSpec): string[] {
  return validateAdhocSpec(spec).map((p) => p.field);
}

describe("validateAdhocSpec", () => {
  it("accepts a well-formed spec", () => {
    expect(validateAdhocSpec(makeSpec())).toEqual([]);
  });

  it("demands a real description", () => {
    expect(problemFields(makeSpec({ description: "fix" }))).toContain("description");
  });

  it("refuses the ledger's own collections", () => {
    for (const collection of ["healRuns", "healBackups", "healTokens", "migrationsRun"]) {
      expect(problemFields(makeSpec({ collection }))).toContain("collection");
    }
  });

  it("refuses an empty filter unless the whole collection is confirmed", () => {
    expect(problemFields(makeSpec({ filter: {} }))).toContain("filter");
    expect(problemFields(makeSpec({ filter: {}, confirmWholeCollection: true }))).not.toContain(
      "filter"
    );
  });

  it("demands a positive expectedMax", () => {
    expect(problemFields(makeSpec({ expectedMax: 0 }))).toContain("expectedMax");
    expect(problemFields(makeSpec({ expectedMax: -1 }))).toContain("expectedMax");
    expect(problemFields(makeSpec({ expectedMax: 2.5 }))).toContain("expectedMax");
  });

  it("refuses a no-op action", () => {
    expect(problemFields(makeSpec({ action: { kind: "set", set: {} } }))).toContain("action.set");
    expect(problemFields(makeSpec({ action: { kind: "unset", unset: [] } }))).toContain(
      "action.unset"
    );
  });

  describe("money-shaped writes", () => {
    const cases = ["liquidCapital", "cashOnHand", "treasuryBalance", "salary", "couponRate"];

    it.each(cases)("forces a declaration when writing %s", (field) => {
      const spec = makeSpec({ action: { kind: "set", set: { [field]: 0 } } });
      expect(problemFields(spec)).toContain("touchesMoney");
    });

    it("passes once declared", () => {
      const spec = makeSpec({
        action: { kind: "set", set: { liquidCapital: 0 } },
        touchesMoney: true,
      });
      expect(validateAdhocSpec(spec)).toEqual([]);
    });

    it("also covers unset", () => {
      const spec = makeSpec({ action: { kind: "unset", unset: ["pendingPayout"] } });
      expect(problemFields(spec)).toContain("touchesMoney");
    });
  });

  it("reports every problem at once rather than the first", () => {
    const spec = makeSpec({ description: "x", collection: "healRuns", expectedMax: 0 });
    expect(problemFields(spec).sort()).toEqual(["collection", "description", "expectedMax"]);
  });
});

describe("compileAdhocDefect", () => {
  it("throws rather than compiling an invalid spec", () => {
    expect(() => compileAdhocDefect(makeSpec({ collection: "healRuns" }))).toThrow(/off limits/);
  });

  it("gives the same id to the same repair", () => {
    expect(adhocId(makeSpec())).toBe(adhocId(makeSpec({ description: "different wording" })));
    expect(adhocId(makeSpec())).not.toBe(adhocId(makeSpec({ filter: { stuck: false } })));
  });

  it("caps at expectedMax and always flags the seed question as unassessed", () => {
    const defect = compileAdhocDefect(makeSpec({ expectedMax: 7 }));
    expect(defect.guards).toContain("max-affected:7");
    expect(defect.seedFix.status).toBe("unknown");
  });

  it("marks a declared money write as mintsMoney so the guard permits it", () => {
    const defect = compileAdhocDefect(
      makeSpec({ action: { kind: "set", set: { liquidCapital: 5 } }, touchesMoney: true })
    );
    expect(defect.mintsMoney).toBe(true);
  });
});

describe("ad-hoc through the runner", () => {
  const IDLE = [{ _id: "live", isActive: true, currentTurn: 100, isProcessing: false }];

  function seed() {
    return makeStrictInMemoryStore({
      gameState: IDLE,
      campaigns: [
        { _id: "c1", stuck: true, name: "a" },
        { _id: "c2", stuck: true, name: "b" },
        { _id: "c3", stuck: false, name: "c" },
      ],
    });
  }

  it("plans, applies and verifies a set", async () => {
    const store = seed();
    const defect = compileAdhocDefect(makeSpec());

    const planned = await runPlan(store.db, defect, { env: "sandbox", operator: "tester" });
    expect(planned.plan.affected).toBe(2);
    expect(planned.token).not.toBeNull();
    // Every ad-hoc repair warns that nobody checked the seed.
    expect(planned.warnings.join(" ")).toContain("SEED NOT ASSESSED");

    const applied = await runApply(store.db, defect, {
      env: "sandbox",
      tokenId: planned.token!.id,
      operator: "tester",
    });
    expect(applied.ok).toBe(true);
    expect(store.cols.campaigns.filter((c) => c.stuck === true)).toHaveLength(0);
    expect(store.cols.campaigns).toHaveLength(3);
  });

  it("refuses when more rows match than expectedMax", async () => {
    const store = seed();
    const defect = compileAdhocDefect(makeSpec({ expectedMax: 1 }));
    const planned = await runPlan(store.db, defect, { env: "sandbox", operator: "tester" });
    expect(planned.token).toBeNull();
    expect(planned.tokenWithheld).toContain("exceeds cap");
  });

  it("snapshots before writing, so an ad-hoc repair is reversible", async () => {
    const store = seed();
    const defect = compileAdhocDefect(makeSpec({ action: { kind: "delete" } }));
    const planned = await runPlan(store.db, defect, { env: "sandbox", operator: "tester" });
    await runApply(store.db, defect, {
      env: "sandbox",
      tokenId: planned.token!.id,
      operator: "tester",
    });

    expect(store.cols.campaigns).toHaveLength(1);
    expect(store.cols.healBackups).toHaveLength(2);
  });

  it("leaves a row that stopped matching between plan and apply alone", async () => {
    const store = seed();
    const defect = compileAdhocDefect(makeSpec());
    const planned = await runPlan(store.db, defect, { env: "sandbox", operator: "tester" });

    // Someone fixes c2 by hand. The token binding catches the change.
    store.cols.campaigns.find((c) => c._id === "c2")!.stuck = false;

    const applied = await runApply(store.db, defect, {
      env: "sandbox",
      tokenId: planned.token!.id,
      operator: "tester",
    });
    expect(applied.ok).toBe(false);
    expect(applied.refusal).toContain("world state moved");
  });

  it("records the repair in healRuns with its description", async () => {
    const store = seed();
    const defect = compileAdhocDefect(makeSpec());
    const planned = await runPlan(store.db, defect, { env: "sandbox", operator: "tester" });
    await runApply(store.db, defect, {
      env: "sandbox",
      tokenId: planned.token!.id,
      operator: "tester",
    });

    const run = store.cols.healRuns[0] as { planSummary: string; defectId: string };
    expect(run.defectId).toMatch(/^ADHOC-campaigns-/);
    expect(run.planSummary).toContain("clear the stuck flag");
  });
});
