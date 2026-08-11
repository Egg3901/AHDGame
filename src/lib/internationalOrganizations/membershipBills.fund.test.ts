import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Db } from "mongodb";

vi.mock("@/lib/internationalOrganizations/service", () => ({
  isMember: vi.fn(),
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));
vi.mock("./organizationFund", () => ({
  convertLocal: vi.fn((_from: string, _to: string, a: number) => a),
  creditOrganizationFund: vi.fn().mockResolvedValue(undefined),
  resolveOrgFundCurrencyCountry: vi.fn().mockResolvedValue("DE"),
}));

const { isMember } = await import("@/lib/internationalOrganizations/service");
const { creditOrganizationFund } = await import("./organizationFund");
const { applyOrgFundProvision } = await import("./membershipBills");

beforeEach(() => vi.clearAllMocks());

const provision = {
  type: "international_organization" as const,
  subType: "fund" as const,
  organizationId: "EU",
  organizationName: "European Union",
  amountLocal: 5_000_000,
};

/** Fake db capturing federalBudget.updateOne calls. */
function fakeDb() {
  const budgetUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const db = {
    collection: (name: string) => {
      if (name === "federalBudget") return { updateOne: budgetUpdate };
      // `convertLocal` is era-scoped now (refs #3778) — one gameState read.
      if (name === "gameState") {
        return { findOne: async () => ({ _id: "current", preset: "2019-default" }) };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return { db, budgetUpdate };
}

describe("applyOrgFundProvision", () => {
  it("debits the treasury and credits the org fund when still a member", async () => {
    vi.mocked(isMember).mockResolvedValue(true);
    const { db, budgetUpdate } = fakeDb();
    await applyOrgFundProvision(db, "DE", provision);
    expect(budgetUpdate).toHaveBeenCalledWith(
      { countryId: "DE" },
      expect.objectContaining({ $inc: { treasuryBalance: -5_000_000 } })
    );
    expect(creditOrganizationFund).toHaveBeenCalledWith(db, "EU", 5_000_000);
  });

  it("voids (no spend) when the country is no longer a member at enactment", async () => {
    vi.mocked(isMember).mockResolvedValue(false);
    const { db, budgetUpdate } = fakeDb();
    await applyOrgFundProvision(db, "DE", provision);
    expect(budgetUpdate).not.toHaveBeenCalled();
    expect(creditOrganizationFund).not.toHaveBeenCalled();
  });
});
