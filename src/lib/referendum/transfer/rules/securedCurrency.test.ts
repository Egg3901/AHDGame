import { describe, expect, it } from "vitest";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { retainsCompletedSecuredCurrency } from "./securedCurrency";
const claim = { claimId: "old", status: "building", fundingCleanupCompleted: true, escrowLocal: 0 };
const sector = (overrides: object = {}) =>
  ({ constructionFinancing: claim, buildQueue: [], ...overrides }) as unknown as CorporateSector;
describe("completed secured assets on reunification", () => {
  it("preserves fully built collateral in its loan's native currency", () => {
    expect(retainsCompletedSecuredCurrency([sector()])).toBe(true);
  });
  it("does not exempt an unfinished financed build", () => {
    expect(() =>
      retainsCompletedSecuredCurrency([sector({ buildQueue: [{ constructionClaimId: "old" }] })])
    ).toThrow();
  });
  it("does not exempt unacknowledged funding or escrow", () => {
    expect(() =>
      retainsCompletedSecuredCurrency([
        sector({ constructionFinancing: { ...claim, escrowLocal: 10 } }),
      ])
    ).toThrow();
  });
  it("converts ordinary unpledged and repaid properties", () => {
    expect(
      retainsCompletedSecuredCurrency([
        {} as CorporateSector,
        sector({ constructionFinancing: { ...claim, status: "released" } }),
      ])
    ).toBe(false);
  });
});
