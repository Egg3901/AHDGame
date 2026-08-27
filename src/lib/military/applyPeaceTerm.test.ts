import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const { convertLocal, ensureFederalBudget, loadWorldPreset, recordProcurementRestriction } =
  vi.hoisted(() => ({
    recordProcurementRestriction: vi.fn(async () => {}),
    // A deliberately non-identity rate, so a test asserting the credited figure
    // fails if the conversion is skipped or applied twice.
    convertLocal: vi.fn((_from: string, _to: string, amount: number) => amount * 2),
    ensureFederalBudget: vi.fn(async () => {}),
    loadWorldPreset: vi.fn(async () => "1953-default"),
  }));

vi.mock("@/lib/internationalOrganizations/organizationFund", () => ({ convertLocal }));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({ loadWorldPreset }));
vi.mock("@/lib/turn/ensureFederalBudget", () => ({ ensureFederalBudget }));
vi.mock("@/lib/db/collections/procurementRestrictions", () => ({ recordProcurementRestriction }));

import { applyPeaceTerm, type ApplyTermContext } from "./applyPeaceTerm";

function mockDb() {
  const updates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const db = {
    collection: () => ({
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        updates.push({ filter, update });
        return { modifiedCount: 1 };
      },
    }),
  } as unknown as Db;
  return { db, updates };
}

const ctx: ApplyTermContext = {
  imposer: "UK",
  target: "TR",
  conflictId: "t1",
  currentTurn: 100,
};

beforeEach(() => {
  convertLocal.mockClear();
  ensureFederalBudget.mockClear();
  recordProcurementRestriction.mockClear();
});

describe("applyPeaceTerm: indemnity", () => {
  it("debits the payer as quoted and credits the recipient converted", async () => {
    // The amount is in the PAYER's currency. Moving the raw number to a different
    // currency would invent or destroy value at the exchange rate.
    const { db, updates } = mockDb();
    await applyPeaceTerm(db, { kind: "indemnity", payer: "TR", amount: 100 }, ctx);
    const incs = updates.map((u) => u.update.$inc);
    expect(incs).toContainEqual({ treasuryBalance: -100 });
    expect(incs).toContainEqual({ treasuryBalance: 200 });
  });

  it("pays the imposer when the target is the payer", async () => {
    const { db, updates } = mockDb();
    await applyPeaceTerm(db, { kind: "indemnity", payer: "TR", amount: 100 }, ctx);
    expect(updates[0]!.filter).toEqual({ countryId: "TR" });
    expect(updates[1]!.filter).toEqual({ countryId: "UK" });
  });

  it("pays the target when the imposer is the payer, so a winner can buy its way out", async () => {
    const { db, updates } = mockDb();
    await applyPeaceTerm(db, { kind: "indemnity", payer: "UK", amount: 100 }, ctx);
    expect(updates[0]!.filter).toEqual({ countryId: "UK" });
    expect(updates[1]!.filter).toEqual({ countryId: "TR" });
  });

  it("heals both budgets before moving money", async () => {
    // Both writes match by countryId and neither upserts. A missing budget on
    // either side means that write matches zero documents and the money silently
    // vanishes.
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "indemnity", payer: "TR", amount: 100 }, ctx);
    expect(ensureFederalBudget).toHaveBeenCalledTimes(2);
  });

  it("moves nothing on a white peace", async () => {
    const { db, updates } = mockDb();
    await applyPeaceTerm(db, { kind: "indemnity", payer: "TR", amount: 0 }, ctx);
    expect(updates).toHaveLength(0);
    expect(ensureFederalBudget).not.toHaveBeenCalled();
  });

  it("never writes debt.principal, which treasuryTurn owns", async () => {
    const { db, updates } = mockDb();
    await applyPeaceTerm(db, { kind: "indemnity", payer: "TR", amount: 100 }, ctx);
    expect(JSON.stringify(updates)).not.toContain("debt.principal");
  });

  it("converts exactly once, so a guard cannot introduce a double conversion", async () => {
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "indemnity", payer: "TR", amount: 100 }, ctx);
    expect(convertLocal).toHaveBeenCalledTimes(1);
  });
});

describe("applyPeaceTerm: demilitarisation", () => {
  it("bars the TARGET, not the imposer", async () => {
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "demilitarisation", turns: 240 }, ctx);
    expect(recordProcurementRestriction).toHaveBeenCalledWith(expect.anything(), "TR", 340, "t1");
  });

  it("counts the duration from the current turn", async () => {
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "demilitarisation", turns: 10 }, { ...ctx, currentTurn: 5 });
    expect(recordProcurementRestriction).toHaveBeenCalledWith(expect.anything(), "TR", 15, "t1");
  });

  it("moves no money", async () => {
    const { db, updates } = mockDb();
    await applyPeaceTerm(db, { kind: "demilitarisation", turns: 240 }, ctx);
    expect(updates).toHaveLength(0);
  });
});

describe("applyPeaceTerm: unimplemented terms", () => {
  it("throws rather than silently doing nothing", async () => {
    // A settlement that reports success and changes nothing is worse than one
    // that fails loudly, because the war resolves either way.
    const { db } = mockDb();
    await expect(
      applyPeaceTerm(db, { kind: "regime_change", targetSystem: "presidential" }, ctx)
    ).rejects.toThrow(/unsupported term/);
  });
});
