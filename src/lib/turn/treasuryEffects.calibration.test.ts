import { describe, it, expect } from "vitest";
import { applyTreasuryEffects } from "./treasuryEffects";
import { getSovereignConfidencePremium } from "@/lib/budget/debt";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";
import {
  DEBT_OP_DURATION_TURNS,
  DEBT_OP_CONFIDENCE_BOOST_PER_TURN,
} from "@/lib/constants/cabinetMonetary";

// Lightweight in-memory db shape, matching treasuryEffects.test.ts. The US budget
// doc id is "federal" (getNationalBudgetId), not the countryId.
function makeDb(opDocs: any[], budgetDocs: any[]) {
  const cols: Record<string, any[]> = { treasuryOperations: opDocs, federalBudget: budgetDocs };
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
  return { collection: (n: string) => col(n) } as any;
}

const opDoc = (boost: number, expiresTurn: number) => ({
  _id: "US",
  countryId: "US",
  activeOp: {
    launchedTurn: 100,
    expiresTurn,
    launchedBy: undefined,
    launchedByName: "S",
    boostPerTurn: boost,
  },
  cooldownUntilTurn: 0,
  history: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe("debt-op calibration", () => {
  it("a full window meaningfully closes a post-shock confidence gap and lowers the premium", async () => {
    // Confidence knocked to 45 (a typical nationalization shock). Run the op window.
    const budgets = [{ _id: "federal", countryId: "US", investorConfidence: 45 }];
    const ops = [opDoc(DEBT_OP_CONFIDENCE_BOOST_PER_TURN, 100 + DEBT_OP_DURATION_TURNS)];
    const db = makeDb(ops, budgets);
    const premiumBefore = getSovereignConfidencePremium(45);
    for (let t = 100; t < 100 + DEBT_OP_DURATION_TURNS; t++) await applyTreasuryEffects(db, t);
    const after = budgets[0].investorConfidence;
    expect(after).toBeGreaterThan(45);
    expect(after).toBeLessThanOrEqual(INVESTOR_CONFIDENCE_BASELINE);
    expect(getSovereignConfidencePremium(after)).toBeLessThan(premiumBefore);
  });

  it("yields zero net benefit when launched at baseline", async () => {
    const budgets = [
      { _id: "federal", countryId: "US", investorConfidence: INVESTOR_CONFIDENCE_BASELINE },
    ];
    const ops = [opDoc(DEBT_OP_CONFIDENCE_BOOST_PER_TURN, 112)];
    const db = makeDb(ops, budgets);
    await applyTreasuryEffects(db, 105);
    expect(budgets[0].investorConfidence).toBe(INVESTOR_CONFIDENCE_BASELINE);
  });
});
