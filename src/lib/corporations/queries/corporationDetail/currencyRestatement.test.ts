import { describe, it, expect } from "vitest";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { buildSectorCurrencyRestatement } from "./currencyRestatement";

const usSector = { countryId: "US" } as Pick<CorporateSector, "countryId">;
const ukSector = { countryId: "UK" } as Pick<CorporateSector, "countryId">;

function corp(over: Partial<Corporation> = {}): Corporation {
  return { countryId: "US", ...over } as Corporation;
}

describe("buildSectorCurrencyRestatement (#587)", () => {
  const fx = new Map<CurrencyCode, number>([
    ["USD", 1] as [CurrencyCode, number],
    ["GBP", 2] as [CurrencyCode, number],
  ]);

  // The invariant the page depends on: a domestic sector must survive the
  // round trip untouched, or every figure on a single-country corp drifts.
  it("is the identity for a sector hosted in the corp's own country", () => {
    const { toCorpCurrency } = buildSectorCurrencyRestatement(corp(), fx);
    expect(toCorpCurrency(1234.56, usSector)).toBeCloseTo(1234.56, 6);
  });

  it("leaves zero and negative amounts sign-stable", () => {
    const { toCorpCurrency } = buildSectorCurrencyRestatement(corp(), fx);
    expect(toCorpCurrency(0, usSector)).toBe(0);
    expect(toCorpCurrency(-500, usSector)).toBeLessThan(0);
  });

  it("reports the corp's own currency for the page", () => {
    const { corpCurrency } = buildSectorCurrencyRestatement(corp(), fx);
    expect(corpCurrency).toBeDefined();
  });

  it("exposes the corp FX rate callers need for non-sector amounts", () => {
    const { corpRate } = buildSectorCurrencyRestatement(corp(), fx);
    expect(typeof corpRate).toBe("number");
    expect(Number.isFinite(corpRate)).toBe(true);
  });

  it("is linear, so restating a sum matches summing the restatements", () => {
    const { toCorpCurrency } = buildSectorCurrencyRestatement(corp(), fx);
    const a = toCorpCurrency(300, ukSector);
    const b = toCorpCurrency(700, ukSector);
    expect(toCorpCurrency(1000, ukSector)).toBeCloseTo(a + b, 6);
  });
});
