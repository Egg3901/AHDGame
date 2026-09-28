import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { applyEuroAdoptionProvision } from "@/lib/billEnactment";
import type { EuroMonetaryUnion } from "@/lib/currency/euro/rules";

function world() {
  const db = createMockDb();
  const state: {
    currentYear: number;
    preset: string;
    eurozoneEnabled: boolean;
    euroAdoptedCountries: string[];
    euroMonetaryUnion?: EuroMonetaryUnion;
  } = {
    currentYear: 1999,
    preset: "1991-default",
    eurozoneEnabled: false,
    euroAdoptedCountries: [],
  };
  db.collection("gameState").findOne.mockImplementation(async () => structuredClone(state));
  db.collection("gameState").updateOne.mockImplementation(
    async (
      _filter: unknown,
      update: { $set?: Record<string, unknown>; $addToSet?: { euroAdoptedCountries?: string } }
    ) => {
      const country = update.$addToSet?.euroAdoptedCountries;
      if (country && !state.euroAdoptedCountries.includes(country))
        state.euroAdoptedCountries.push(country);
      Object.assign(state, update.$set);
      return { matchedCount: 1 };
    }
  );
  db.collection("organizationMemberships").find.mockReturnValue({
    toArray: async () => ["DE", "IE", "UK"].map((countryId) => ({ countryId })),
  });
  db.collection("exchangeRates").find.mockReturnValue({
    toArray: async () => [
      { currencyCode: "EUR", rate: 0.85 },
      { currencyCode: "IEP", rate: 0.7 },
      { currencyCode: "GBP", rate: 0.6 },
    ],
  });
  db.collection("centralBanks").find.mockReturnValue({
    toArray: async () => ["ECB", "IE", "UK"].map((_id) => ({ _id })),
  });
  db.collection("centralBanks").findOne.mockResolvedValue({ _id: "ECB", primeRate: 3 });
  db.collection("centralBanks").bulkWrite.mockImplementation(async (ops: unknown[]) => ({
    matchedCount: ops.length,
  }));
  return { db, asDb: db as unknown as Db, state };
}

describe("enacted euro adoption", () => {
  it("records one founder's consent without imposing adoption on the other", async () => {
    const w = world();
    await applyEuroAdoptionProvision(w.asDb, "DE", 385, "de-law");
    expect(w.state.euroAdoptedCountries).toEqual(["DE"]);
    expect(w.state.eurozoneEnabled).toBe(false);
    expect(w.state.euroMonetaryUnion).toBeUndefined();
  });

  it("settles after both founders consent and lets the UK join at its prevailing rate", async () => {
    const w = world();
    await applyEuroAdoptionProvision(w.asDb, "DE", 385, "de-law");
    await applyEuroAdoptionProvision(w.asDb, "IE", 386, "ie-law");
    expect(w.state.euroMonetaryUnion?.members.UK).toBeUndefined();
    await applyEuroAdoptionProvision(w.asDb, "UK", 387, "uk-law");
    expect(w.state.euroMonetaryUnion?.members.UK?.ledgerUnitsPerAnchorUnit).toBeCloseTo(0.6 / 0.85);
    expect(w.state.eurozoneEnabled).toBe(true);
    const original = structuredClone(w.state);
    await applyEuroAdoptionProvision(w.asDb, "UK", 388, "uk-law");
    expect(w.state).toEqual(original);
    expect(
      w.db.collectionMocks.gameState.updateOne.mock.calls.filter(([, update]) => update.$addToSet)
    ).toHaveLength(3);
  });

  it("rejects an early decision without writing consent", async () => {
    const w = world();
    w.state.currentYear = 1991;
    await expect(applyEuroAdoptionProvision(w.asDb, "DE", 1, "early-law")).rejects.toThrow("1999");
    expect(w.db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });

  it("keeps an enacted authorization contingent when membership changes before enactment", async () => {
    const w = world();
    w.db.collection("organizationMemberships").find.mockReturnValue({ toArray: async () => [] });
    await applyEuroAdoptionProvision(w.asDb, "DE", 385, "de-law");
    await applyEuroAdoptionProvision(w.asDb, "IE", 385, "ie-law");
    expect(w.state.euroAdoptedCountries).toEqual(["DE", "IE"]);
    expect(w.state.euroMonetaryUnion).toBeUndefined();
    expect(w.state.eurozoneEnabled).toBe(false);
  });
});
