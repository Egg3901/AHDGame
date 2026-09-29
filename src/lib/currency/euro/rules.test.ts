import { aggregateEuroPolicyIndicators, euroCurrencyRate, euroSettlementRates } from "./rules";
import { describe, expect, it } from "vitest";
import {
  euroAdoptionRefusal,
  euroPolicyBankId,
  linkedEuroRates,
  planEuroSettlement,
} from "./rules";

const initial = {
  year: 1999,
  turn: 385,
  preset: "1991-default",
  europeanMembers: ["DE", "IE", "UK"],
  consentedCountries: ["DE", "IE"] as const,
  rates: { EUR: 0.85, IEP: 0.7, GBP: 0.6 },
};

function founded() {
  const union = planEuroSettlement(initial).union;
  if (!union) throw new Error("Expected the ratified founding compact");
  return union;
}

describe("national euro adoption", () => {
  it("allows a UK member to opt in after the availability date", () => {
    expect(
      euroAdoptionRefusal({
        countryId: "UK",
        year: 1999,
        europeanMembers: initial.europeanMembers,
        consentedCountries: [],
      })
    ).toBeNull();
  });
  it("does not admit the UK merely because the founders consented", () => {
    expect(founded().members.UK).toBeUndefined();
    expect(euroPolicyBankId("UK", founded())).toBe("UK");
  });
  it.each([
    { year: 1998, europeanMembers: initial.europeanMembers, consentedCountries: [] },
    { year: 1999, europeanMembers: ["DE", "IE"], consentedCountries: [] },
    { year: 1999, europeanMembers: initial.europeanMembers, consentedCountries: ["UK"] as const },
  ])("refuses an unavailable or duplicate decision", (conditions) => {
    expect(euroAdoptionRefusal({ ...conditions, countryId: "UK" })).not.toBeNull();
  });
  it("does not let a currency user change its issuer's currency unilaterally", () => {
    expect(
      euroAdoptionRefusal({
        countryId: "SCO",
        year: 1999,
        europeanMembers: ["SCO"],
        consentedCountries: [],
      })
    ).toContain("sharing another issuer");
  });
  it("waits for both founders rather than forcing the calendar outcome", () => {
    expect(planEuroSettlement({ ...initial, consentedCountries: ["DE"] }).union).toBeUndefined();
    expect(planEuroSettlement({ ...initial, year: 1998 }).union).toBeUndefined();
    expect(planEuroSettlement({ ...initial, europeanMembers: ["IE", "UK"] }).union).toBeUndefined();
  });
  it("does not publish half a union when one founder's rate is unavailable", () => {
    expect(planEuroSettlement({ ...initial, rates: { EUR: 0.85 } })).toEqual({
      union: undefined,
      addedCountries: [],
      pending: true,
    });
  });
  it("locks later UK entry at the prevailing rate without changing existing locks", () => {
    const existing = founded();
    const input = {
      ...initial,
      existing,
      turn: 400,
      consentedCountries: ["DE", "IE", "UK"] as const,
      rates: { EUR: 1, IEP: 0.7 / 0.85, GBP: 0.75 },
    };
    const plan = planEuroSettlement(input);
    expect(plan.addedCountries).toEqual(["UK"]);
    expect(plan.union?.members.UK?.ledgerCurrency).toBe("GBP");
    expect(plan.union?.members.UK?.ledgerUnitsPerAnchorUnit).toBe(0.75);
    expect(plan.union?.members.IE).toEqual(existing.members.IE);
    expect(existing.members.UK).toBeUndefined();
    expect(euroPolicyBankId("UK", plan.union)).toBe("ECB");
    expect(euroPolicyBankId("SCO", plan.union)).toBe("ECB");
    expect(euroPolicyBankId("US", plan.union)).toBe("US");
    expect(planEuroSettlement({ ...input, existing: plan.union }).addedCountries).toEqual([]);
  });
  it("keeps an existing member's monetary settlement after organization withdrawal", () => {
    const existing = founded();
    const plan = planEuroSettlement({
      ...initial,
      existing,
      europeanMembers: [],
      consentedCountries: [],
    });
    expect(plan.union).toEqual(existing);
  });
  it("preserves an already-enabled old world as an explicit settlement", () => {
    const plan = planEuroSettlement({
      ...initial,
      year: 1991,
      europeanMembers: [],
      consentedCountries: [],
      legacyEnabled: true,
    });
    expect(plan.union?.members.IE?.source).toBe("legacy-settlement");
    expect(plan.union?.members.UK).toBeUndefined();
  });
  it("records the actual 1953 anchor denomination", () => {
    expect(
      planEuroSettlement({ ...initial, preset: "1953-default", rates: { EUR: 4.2, IEP: 0.357 } })
        .union?.anchorUnitsPerEuro
    ).toBe(1.95583);
  });
});

describe("fixed legacy-unit conversion", () => {
  it("preserves every opening balance's anchor value at adoption", () => {
    const union = founded();
    const linked = linkedEuroRates(union, initial.rates);
    for (const code of ["EUR", "IEP"] as const) {
      expect(123456 / linked[code]!).toBeCloseTo(123456 / initial.rates[code], 8);
    }
  });
  it("uses the same-turn anchor quotation and ignores independent member drift", () => {
    const union = founded();
    const rates = linkedEuroRates(union, { IEP: 999, EUR: 1.2 });
    expect(rates.IEP).toBeCloseTo((1.2 * 0.7) / 0.85);
    expect(rates).toEqual(linkedEuroRates(union, { EUR: 1.2, IEP: 0.1 }));
    expect(rates.EUR).toBe(1.2);
  });
  it.each([undefined, NaN, Infinity, 0, -1])("rejects an invalid common quotation %s", (EUR) => {
    expect(() => linkedEuroRates(founded(), { EUR })).toThrow("unavailable");
  });
});

describe("common monetary policy indicators", () => {
  it("weights all participating economies by GDP in shared accounting units", () => {
    expect(
      aggregateEuroPolicyIndicators([
        { gdpAnchor: 100, inflationRate: 2, gdpGrowth: 4, targetInflation: 2, neutralRate: 3 },
        { gdpAnchor: 300, inflationRate: 6, gdpGrowth: 0, targetInflation: 2, neutralRate: 5 },
      ])
    ).toEqual({ inflationRate: 5, gdpGrowth: 1, targetInflation: 2, neutralRate: 4.5 });
  });
  it("refuses incomplete member data instead of silently using the anchor country", () => {
    expect(aggregateEuroPolicyIndicators([])).toBeUndefined();
    expect(
      aggregateEuroPolicyIndicators([
        { gdpAnchor: 100, inflationRate: NaN, gdpGrowth: 4, targetInflation: 2, neutralRate: 3 },
      ])
    ).toBeUndefined();
  });
  it("preserves weighting when GDP units are rescaled", () => {
    const rows = [1, 3].map((gdpAnchor) => ({
      gdpAnchor,
      inflationRate: gdpAnchor * 2,
      gdpGrowth: 2,
      targetInflation: 2,
      neutralRate: 3,
    }));
    expect(
      aggregateEuroPolicyIndicators(
        rows.map((row) => ({ ...row, gdpAnchor: row.gdpAnchor * 1e300 }))
      )
    ).toEqual(aggregateEuroPolicyIndicators(rows));
  });
});

it("keeps euro authorization pending while Maastricht is unratified", () => {
  expect(
    euroAdoptionRefusal({ ...initial, countryId: "UK", europeanStage: "community" })
  ).toContain("ratified");
  expect(planEuroSettlement({ ...initial, europeanStage: "community" })).toMatchObject({
    union: undefined,
    addedCountries: [],
    pending: true,
  });
  expect(planEuroSettlement({ ...initial, europeanStage: "union" }).union).toBeDefined();
  const existing = founded();
  expect(
    planEuroSettlement({
      ...initial,
      existing,
      europeanStage: "community",
      consentedCountries: ["DE", "IE", "UK"],
    })
  ).toMatchObject({ union: existing, addedCountries: [], pending: true });
});

it("derives external member quotes from the anchor and fails closed without it", () => {
  const union = founded();
  expect(euroCurrencyRate(union, "IEP", { EUR: 1.7, IEP: 99 })).toBeCloseTo(1.4);
  expect(euroCurrencyRate(union, "IEP", { IEP: 99 })).toBeUndefined();
  expect(euroCurrencyRate(union, "USD", { USD: 1 })).toBe(1);
  expect(euroCurrencyRate(undefined, "GBP", { GBP: 0.6 })).toBe(0.6);
  expect(euroCurrencyRate(union, "IEP", { EUR: Number.NaN })).toBeUndefined();
});

describe("euro settlement quote snapshots", () => {
  it("replaces stale member quotes while preserving independent quotes", () => {
    const union = founded();
    const rates = { EUR: 2, IEP: 99, USD: 1, JPY: 100 };
    const snapshot = euroSettlementRates(union, rates);
    expect(snapshot.get("IEP")).toBeCloseTo(2 * (0.7 / 0.85));
    expect(snapshot.get("EUR")).toBe(2);
    expect(snapshot.get("JPY")).toBe(100);
    expect(snapshot.get("USD")).toBe(1);
    expect(rates.IEP).toBe(99);
  });

  it("does not substitute stale member quotes when the anchor is missing", () => {
    expect([...euroSettlementRates(founded(), { IEP: 99, USD: 1 })]).toEqual([["USD", 1]]);
  });

  it("preserves absent currencies and rejects invalid independent quotes", () => {
    const rates = euroSettlementRates(undefined, { USD: 1, GBP: Number.NaN, JPY: -5 });
    expect([...rates]).toEqual([["USD", 1]]);
    expect(rates.has("EUR")).toBe(false);
  });
});
