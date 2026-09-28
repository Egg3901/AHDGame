import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { EuroMonetaryUnion } from "./rules";
import { reconcileEuroMonetaryUnion } from "./service";
import { resolveJurisdiction } from "@/lib/monetaryGovernance/jurisdiction";

function world() {
  const db = createMockDb();
  const state: {
    _id: string;
    currentYear: number;
    startingYear: number;
    currentTurn: number;
    preset: string;
    eurozoneEnabled: boolean;
    euroAdoptedCountries: ("DE" | "IE" | "UK")[];
    euroMonetaryUnion?: EuroMonetaryUnion;
  } = {
    _id: "current",
    currentYear: 1999,
    startingYear: 1991,
    currentTurn: 385,
    preset: "1991-default",
    eurozoneEnabled: false,
    euroAdoptedCountries: ["DE", "IE", "UK"],
  };
  const banks: Record<string, unknown>[] = [
    {
      _id: "ECB",
      countryId: "DE",
      primeRate: 3,
      primeRateSmoothed: 3.25,
      chairInfamy: 8,
      reserveBalance: 1000,
    },
    { _id: "IE", countryId: "IE", primeRate: 5, reserveBalance: 2000, bankReserveRequirement: 0.2 },
    { _id: "UK", countryId: "UK", primeRate: 6, reserveBalance: 3000 },
  ];
  const rates = [
    { currencyCode: "EUR", rate: 0.85 },
    { currencyCode: "IEP", rate: 0.7 },
    { currencyCode: "GBP", rate: 0.6 },
  ];
  db.collection("gameState").findOne.mockImplementation(async () => structuredClone(state));
  db.collection("gameState").updateOne.mockImplementation(async (_filter, update) => {
    Object.assign(state, update.$set);
    return { matchedCount: 1 };
  });
  db.collection("organizationMemberships").find.mockReturnValue({
    toArray: async () => [{ countryId: "DE" }, { countryId: "IE" }, { countryId: "UK" }],
  });
  db.collection("exchangeRates").find.mockReturnValue({ toArray: async () => rates });
  db.collection("centralBanks").find.mockReturnValue({ toArray: async () => banks });
  db.collection("centralBanks").findOne.mockImplementation(async (filter) =>
    banks.find((bank) => bank._id === filter._id)
  );
  db.collection("centralBanks").bulkWrite.mockImplementation(async (ops) => {
    for (const {
      updateOne: { filter, update },
    } of ops) {
      const bank = banks.find((bank) => bank._id === filter._id);
      if (!bank) continue;
      Object.assign(bank, update.$set);
      for (const key of Object.keys(update.$unset ?? {})) delete bank[key];
    }
    return { matchedCount: ops.length };
  });
  return { db, asDb: db as unknown as Db, state, banks, rates };
}

describe("euro settlement persistence", () => {
  it("preserves financial balances while applying the common policy and jurisdiction", async () => {
    const w = world();
    const union = await reconcileEuroMonetaryUnion(w.asDb, 385);
    expect(union?.members.UK?.ledgerUnitsPerAnchorUnit).toBeCloseTo(0.6 / 0.85);
    expect(w.banks.map((bank) => bank.reserveBalance)).toEqual([1000, 2000, 3000]);
    expect(w.banks.map((bank) => bank.primeRate)).toEqual([3, 3, 3]);
    expect(w.banks[1].bankReserveRequirement).toBeUndefined();
    const scope = await resolveJurisdiction(w.asDb, "UK");
    expect(scope.institutionId).toBe("ECB");
    expect(scope.currency).toBe("EUR");
    expect(scope.memberCountryIds).toEqual(expect.arrayContaining(["DE", "IE", "UK"]));
    expect(w.db.collectionMocks.gameState.updateOne.mock.calls[0][0]).toEqual({
      _id: "current",
      "euroMonetaryUnion.revision": { $exists: false },
    });
  });

  it("retries a failed policy materialization without requoting the accepted conversion", async () => {
    const w = world();
    w.db.collectionMocks.centralBanks.bulkWrite.mockRejectedValueOnce(
      new Error("temporary write failure")
    );
    await expect(reconcileEuroMonetaryUnion(w.asDb, 385)).rejects.toThrow(
      "temporary write failure"
    );
    const original = structuredClone(w.state.euroMonetaryUnion);
    w.rates[2].rate = 99;
    await reconcileEuroMonetaryUnion(w.asDb, 386);
    expect(w.state.euroMonetaryUnion).toEqual(original);
    expect(w.db.collectionMocks.gameState.updateOne).toHaveBeenCalledTimes(1);
    expect(w.banks[2].primeRate).toBe(3);
  });

  it("does not publish membership if a national financial account is missing", async () => {
    const w = world();
    w.banks.pop();
    await expect(reconcileEuroMonetaryUnion(w.asDb, 385)).rejects.toThrow(
      "existing national bank for UK"
    );
    expect(w.state.euroMonetaryUnion).toBeUndefined();
    expect(w.db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });

  it("keeps rejected founding decisions dormant with no financial writes", async () => {
    const w = world();
    w.state.euroAdoptedCountries = ["DE"];
    expect(await reconcileEuroMonetaryUnion(w.asDb, 385)).toBeUndefined();
    expect(w.db.collectionMocks.centralBanks.bulkWrite).not.toHaveBeenCalled();
  });

  it("retries a lost optimistic-lock race from the next state snapshot", async () => {
    const w = world();
    w.db.collectionMocks.gameState.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    const union = await reconcileEuroMonetaryUnion(w.asDb, 385);
    expect(union?.revision).toBe(1);
    expect(w.db.collectionMocks.gameState.updateOne).toHaveBeenCalledTimes(2);
  });
});
