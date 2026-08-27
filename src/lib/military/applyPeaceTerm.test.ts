import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const {
  convertLocal,
  ensureFederalBudget,
  loadWorldPreset,
  recordProcurementRestriction,
  installOnePartyState,
  triggerSystemConversion,
  updateCountryState,
} = vi.hoisted(() => ({
  recordProcurementRestriction: vi.fn(async (..._a: unknown[]) => {}),
  installOnePartyState: vi.fn(async (..._a: unknown[]) => {}),
  triggerSystemConversion: vi.fn(async (..._a: unknown[]) => {}),
  updateCountryState: vi.fn(async (..._a: unknown[]) => ({}) as never),
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
vi.mock("@/lib/countryState", () => ({ updateCountryState }));
vi.mock("@/lib/onePartyState/installOnePartyState", () => ({ installOnePartyState }));
vi.mock("@/lib/onePartyState/systemConversion", () => ({
  triggerSystemConversion,
  FORCED_ELECTION_DELAY_TURNS: 12,
  FORCED_LEGACY_RESERVATION: 5,
  FORCED_VOTE_SHARE_PENALTY: -0.2,
}));

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
  installOnePartyState.mockClear();
  triggerSystemConversion.mockClear();
  updateCountryState.mockClear();
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

describe("applyPeaceTerm: regime change", () => {
  it("installs a one-party state when that is the target system", async () => {
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "regime_change", targetSystem: "onePartyState" }, ctx);
    expect(installOnePartyState).toHaveBeenCalledWith(expect.anything(), "TR", 100);
    expect(triggerSystemConversion).not.toHaveBeenCalled();
  });

  it("uses the shipped conversion when the target system is a democracy", async () => {
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "regime_change", targetSystem: "presidential" }, ctx);
    expect(triggerSystemConversion).toHaveBeenCalled();
    expect(installOnePartyState).not.toHaveBeenCalled();
  });

  it("converts the TARGET, never the imposer", async () => {
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "regime_change", targetSystem: "onePartyState" }, ctx);
    expect(installOnePartyState).toHaveBeenCalledWith(expect.anything(), "TR", expect.anything());
  });

  it("queues the election marker when installing a one-party state", async () => {
    // installOnePartyState schedules nothing itself, so without this the country
    // would convert and never go to the polls.
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "regime_change", targetSystem: "onePartyState" }, ctx);
    expect(updateCountryState).toHaveBeenCalledWith(
      expect.anything(),
      "TR",
      expect.objectContaining({
        pendingPostConversionElection: expect.objectContaining({ atTurn: 112, path: "forced" }),
      })
    );
  });

  it("leaves the marker to the shipped conversion in the other direction", async () => {
    // triggerSystemConversion writes it via bootstrapNewSystem, capturing the
    // former ruling party before the flip clears it. Writing it again here would
    // overwrite that capture with a null.
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "regime_change", targetSystem: "presidential" }, ctx);
    expect(updateCountryState).not.toHaveBeenCalled();
  });

  it("delays the election, so the fall of the government is visible", async () => {
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "regime_change", targetSystem: "presidential" }, ctx);
    const inputs = triggerSystemConversion.mock.calls[0]![3] as { electionAtTurn: number };
    expect(inputs.electionAtTurn).toBe(112);
  });

  it("fires no election directly, because this runs on a request path", async () => {
    // Spawning elections from a request would spawn them again on a retry. The
    // turn step reads the marker instead.
    const { db } = mockDb();
    await applyPeaceTerm(db, { kind: "regime_change", targetSystem: "onePartyState" }, ctx);
    const patch = JSON.stringify(updateCountryState.mock.calls);
    expect(patch).toContain("pendingPostConversionElection");
  });
});
