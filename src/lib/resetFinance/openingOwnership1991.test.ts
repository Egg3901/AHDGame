import { describe, expect, it } from "vitest";
import { openingFiscalOwnership1991, openingNamedGrantClaims1991 } from "./openingOwnership1991";
import { reconcileOpeningOwnership } from "./rules/openingOwnership";

describe("1991 opening fiscal ownership", () => {
  it("books each protected named transfer once despite legal-lineage copies", () => {
    const grants = openingNamedGrantClaims1991();
    expect(Object.values(grants.US).reduce((sum, amount) => sum + amount, 0)).toBe(0);
    expect(Object.values(grants.UK).reduce((sum, amount) => sum + amount, 0)).toBe(16_399_000_000);
    expect(Object.values(grants.JP).reduce((sum, amount) => sum + amount, 0)).toBe(
      15_872_000_000_000
    );
  });

  it("reconciles law families and unsplit predecessor obligations exactly", () => {
    const owned = openingFiscalOwnership1991();
    expect(owned.US.operating).toBe(695_338_599_991);
    expect(owned.US.continuityOwned).toBe(144_993_226_307);
    expect(owned.UK.continuityOwned).toBe(35_680_556_447);
    expect(owned.JP.continuityOwned).toBe(1_736_000_000_000);
    for (const country of ["US", "UK", "JP"] as const) {
      expect(owned[country].familyOwned + owned[country].continuityOwned).toBe(
        owned[country].operating
      );
    }
    expect(owned.US.continuity.map((account) => account.sourceId)).toEqual([
      "us_social_security",
      "us_medicaid",
      "us_drug_pricing_medicare",
    ]);
    expect(owned.UK.continuity.map((account) => account.sourceId)).toEqual([
      "uk_universal_credit",
      "uk_trident_defence",
    ]);
    expect(owned.JP.continuity[0].sourceId).toBe("jp_foreign_aid");
  });

  it("rejects double-booking and unexplained budget gaps", () => {
    const claim = {
      sourceId: "source-a",
      familyId: "L01",
      amount: 10,
      disposition: "retained-legal-lineage" as const,
      treatment: "retained-opening-obligation",
    };
    expect(() => reconcileOpeningOwnership(20, [claim, claim])).toThrow(/duplicate/);
    expect(() => reconcileOpeningOwnership(20, [claim])).toThrow(/gap/);
    expect(() => reconcileOpeningOwnership(10, [{ ...claim, disposition: "unknown" }])).toThrow(
      /disposition/
    );
    expect(() =>
      reconcileOpeningOwnership(10, [
        {
          ...claim,
          disposition: "not-adopted-as-1991-law",
          treatment: "no-separate-source-cost",
        },
      ])
    ).toThrow(/excluded law/);
  });
});
