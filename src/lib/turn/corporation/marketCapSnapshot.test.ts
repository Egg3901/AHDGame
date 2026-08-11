import { describe, it, expect } from "vitest";
import { resolveSnapshotDenomination, foldDividendTaxIntoTaxMaps } from "./marketCapSnapshot";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * #2973: a corp history row must only be stamped with a `currencyCode` when its
 * FX rate is actually present and usable. Otherwise the monetary fields are
 * written as raw anchor (₳) while the label claims a local currency, and the
 * chart reader divides by the live rate -> up to ~100x understatement.
 */
describe("resolveSnapshotDenomination (#2973)", () => {
  const rates = new Map<CurrencyCode, number>([
    ["JPY", 106],
    ["CNY", 6.4],
    ["USD", 0.89],
  ]);

  it("stamps the code and rate when the FX rate is present", () => {
    expect(resolveSnapshotDenomination({ liquidCurrencyCode: "JPY" }, rates)).toEqual({
      code: "JPY",
      rate: 106,
    });
  });

  it("resolves the code from countryId when there is no explicit liquidCurrencyCode", () => {
    expect(resolveSnapshotDenomination({ countryId: "JP" }, rates)).toEqual({
      code: "JPY",
      rate: 106,
    });
  });

  it("falls back to anchor (no code) when the resolvable code's rate is MISSING", () => {
    // JPY resolves as the code but is absent from this map. Stamping "JPY" here
    // while writing unconverted anchor is exactly the #2973 trap.
    const noJpy = new Map<CurrencyCode, number>([["USD", 0.89]]);
    expect(resolveSnapshotDenomination({ liquidCurrencyCode: "JPY" }, noJpy)).toEqual({
      code: undefined,
      rate: 1,
    });
  });

  it("falls back to anchor when the rate is zero or negative", () => {
    const bad = new Map<CurrencyCode, number>([
      ["JPY", 0],
      ["CNY", -3],
    ]);
    expect(resolveSnapshotDenomination({ liquidCurrencyCode: "JPY" }, bad)).toEqual({
      code: undefined,
      rate: 1,
    });
    expect(resolveSnapshotDenomination({ liquidCurrencyCode: "CNY" }, bad)).toEqual({
      code: undefined,
      rate: 1,
    });
  });

  it("falls back to anchor when the corp has no resolvable currency", () => {
    expect(resolveSnapshotDenomination({}, rates)).toEqual({ code: undefined, rate: 1 });
  });
});

/**
 * #3115: the 50% dividend-received-deduction tax is folded into the Phase-8
 * history row (the Phase-3c updateOne no-op'd because the row didn't exist yet).
 * The fold must be non-mutating (the base maps are shared with the tax-ledger
 * emitter) and land in both the combined and domestic per-country maps.
 */
describe("foldDividendTaxIntoTaxMaps (#3115)", () => {
  it("returns copies and leaves the base maps untouched", () => {
    const base = new Map([["US", 100]]);
    const baseDom = new Map([["US", 100]]);
    const div = new Map([["US", 40]]);
    const out = foldDividendTaxIntoTaxMaps(base, baseDom, div);

    expect(base.get("US")).toBe(100); // not mutated
    expect(baseDom.get("US")).toBe(100);
    expect(out.mergedTaxByCountry.get("US")).toBe(140);
    expect(out.mergedTaxByCountryDomestic.get("US")).toBe(140);
    expect(out.divTaxTotalAnchor).toBe(40);
  });

  it("adds a new home country not present in the base maps", () => {
    const out = foldDividendTaxIntoTaxMaps(new Map(), new Map(), new Map([["NG", 25]]));
    expect(out.mergedTaxByCountry.get("NG")).toBe(25);
    expect(out.mergedTaxByCountryDomestic.get("NG")).toBe(25);
    expect(out.divTaxTotalAnchor).toBe(25);
  });

  it("sums across multiple countries and skips non-positive amounts", () => {
    const out = foldDividendTaxIntoTaxMaps(
      new Map([["US", 10]]),
      new Map([["US", 10]]),
      new Map([
        ["US", 5],
        ["UK", 0],
        ["DE", -3],
        ["JP", 7],
      ])
    );
    expect(out.mergedTaxByCountry.get("US")).toBe(15);
    expect(out.mergedTaxByCountry.get("JP")).toBe(7);
    expect(out.mergedTaxByCountry.has("UK")).toBe(false);
    expect(out.mergedTaxByCountry.has("DE")).toBe(false);
    expect(out.divTaxTotalAnchor).toBe(12); // 5 + 7
  });

  it("is a no-op when no dividend tax is supplied", () => {
    const out = foldDividendTaxIntoTaxMaps(new Map([["US", 10]]), new Map([["US", 10]]), undefined);
    expect(out.divTaxTotalAnchor).toBe(0);
    expect(out.mergedTaxByCountry.get("US")).toBe(10);
  });
});
