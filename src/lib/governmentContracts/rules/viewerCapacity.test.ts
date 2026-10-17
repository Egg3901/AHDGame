import { it, expect } from "vitest";
import { hasCurrentTenderCapacity } from "./viewerCapacity";
const input: Parameters<typeof hasCurrentTenderCapacity>[0] = {
  terms: { type: "defence", component: "ground", lots: 1, grade: 0, maximumPricePerLot: 1000 },
  countryId: "US",
  corporation: { type: "defense", countryId: "US", liquidCurrencyCode: "USD" },
  sectors: [
    { id: "p", stateId: "TX", sectorType: "defense", revenue: 100, strategyId: "standard" },
  ],
  year: 1994,
  maximumGrade: 3,
  anchor: 1000,
  ratios: new Map(),
  procurementNotional: 1e6,
  supplierAmount: 0,
  stateOwned: false,
  commitments: new Map(),
};
it("requires present output and uncommitted production lines as well as shared bid checks", () => {
  expect(hasCurrentTenderCapacity(input)).toBe(true);
  expect(
    hasCurrentTenderCapacity({ ...input, sectors: [{ ...input.sectors[0], revenue: 0 }] })
  ).toBe(false);
  expect(
    hasCurrentTenderCapacity({
      ...input,
      commitments: new Map([["p", [{ assignedFactories: 4 }]]]),
    })
  ).toBe(false);
  expect(hasCurrentTenderCapacity({ ...input, supplierAmount: 1e6 })).toBe(false);
  expect(
    hasCurrentTenderCapacity({ ...input, corporation: { ...input.corporation, countryId: "JP" } })
  ).toBe(false);
});
it("counts legacy commitments and does not double-count a second sector's free slots", () => {
  expect(
    hasCurrentTenderCapacity({
      ...input,
      commitments: new Map([["p", Array.from({ length: 4 }, () => ({}))]]),
    })
  ).toBe(false);
  expect(
    hasCurrentTenderCapacity({
      ...input,
      sectors: [{ ...input.sectors[0], id: "other" }],
      commitments: new Map([["p", [{ assignedFactories: 4 }]]]),
    })
  ).toBe(true);
});
it("treats extraction as a concession with state-operation eligibility", () => {
  const extraction: Parameters<typeof hasCurrentTenderCapacity>[0] = {
    ...input,
    terms: {
      type: "extraction",
      stateId: "TX",
      resource: "iron",
      share: 0.1,
      termTurns: 48,
      royaltyRatePerTurn: 0.01,
      minimumSigningFeeAnchor: 500,
    } as const,
    corporation: { type: "extraction", countryId: "US" },
  };
  expect(hasCurrentTenderCapacity(extraction)).toBe(true);
  expect(hasCurrentTenderCapacity({ ...extraction, sectors: [] })).toBe(false);
});
