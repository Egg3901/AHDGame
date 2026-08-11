import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { applyTreasuryEffects } from "./treasuryEffects";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";
import { getSovereignConfidencePremium } from "@/lib/budget/debt";

// Minimal in-memory Mongo stand-in for the two collections this step touches.
function makeDb(opDocs: any[], budgetDocs: any[]) {
  const cols: Record<string, any[]> = {
    treasuryOperations: opDocs,
    federalBudget: budgetDocs,
  };
  function setPath(obj: any, path: string, val: any) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] ??= {};
    cur[parts[parts.length - 1]] = val;
  }
  function col(name: string) {
    const arr = cols[name];
    return {
      find: (q: any = {}) => ({
        toArray: async () =>
          arr.filter((d) => (q.activeOp && q.activeOp.$ne === null ? d.activeOp != null : true)),
      }),
      findOne: async (q: any) => arr.find((d) => d._id === q._id) ?? null,
      updateOne: async (q: any, u: any) => {
        const d = arr.find((x) => x._id === q._id);
        if (!d) return { modifiedCount: 0 };
        if (u.$set) for (const [k, v] of Object.entries(u.$set)) setPath(d, k, v);
        if (u.$push) for (const [k, v] of Object.entries(u.$push)) (d[k] ??= []).push(v);
        return { modifiedCount: 1 };
      },
    };
  }
  return { collection: (name: string) => col(name) } as any;
}

const op = (over: any = {}) => ({
  _id: "US",
  countryId: "US",
  activeOp: {
    launchedTurn: 100,
    expiresTurn: 112,
    launchedBy: new ObjectId(),
    launchedByName: "Sec",
    boostPerTurn: 1.0,
  },
  cooldownUntilTurn: 124,
  history: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe("applyTreasuryEffects", () => {
  it("boosts confidence while active and below baseline", async () => {
    const ops = [op()];
    const budgets = [{ _id: "federal", countryId: "US", investorConfidence: 50 }];
    const r = await applyTreasuryEffects(makeDb(ops, budgets), 105);
    expect(r.opsApplied).toBe(1);
    expect(budgets[0].investorConfidence).toBe(51);
  });

  it("clamps at baseline and never exceeds it", async () => {
    const ops = [op()];
    const budgets = [
      { _id: "federal", countryId: "US", investorConfidence: INVESTOR_CONFIDENCE_BASELINE - 0.5 },
    ];
    await applyTreasuryEffects(makeDb(ops, budgets), 105);
    expect(budgets[0].investorConfidence).toBe(INVESTOR_CONFIDENCE_BASELINE);
  });

  it("does nothing when already at/above baseline (premium stays 0)", async () => {
    const ops = [op()];
    const budgets = [
      { _id: "federal", countryId: "US", investorConfidence: INVESTOR_CONFIDENCE_BASELINE },
    ];
    await applyTreasuryEffects(makeDb(ops, budgets), 105);
    expect(budgets[0].investorConfidence).toBe(INVESTOR_CONFIDENCE_BASELINE);
    expect(getSovereignConfidencePremium(budgets[0].investorConfidence)).toBe(0);
  });

  it("expires the op at expiresTurn and stamps history", async () => {
    const ops = [op()];
    const budgets = [{ _id: "federal", countryId: "US", investorConfidence: 50 }];
    const r = await applyTreasuryEffects(makeDb(ops, budgets), 112);
    expect(r.opsExpired).toBe(1);
    expect(ops[0].activeOp).toBeNull();
    expect(ops[0].history).toHaveLength(1);
  });

  it("is a no-op when there are no active ops", async () => {
    const ops = [op({ activeOp: null })];
    const budgets = [{ _id: "federal", countryId: "US", investorConfidence: 50 }];
    const r = await applyTreasuryEffects(makeDb(ops, budgets), 105);
    expect(r).toEqual({ opsApplied: 0, opsExpired: 0 });
    expect(budgets[0].investorConfidence).toBe(50);
  });
});
