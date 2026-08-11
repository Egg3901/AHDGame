import { describe, expect, it } from "vitest";
import { validateCatalog } from "../validate";
import { DD_LAWS } from "./ddLaws";
import { RU_LAWS } from "./ruLaws";

describe("DD catalog", () => {
  it("passes the full catalog validator", () => {
    expect(validateCatalog(DD_LAWS, "DD")).toEqual([]);
  });

  it("carries exactly 63 primaries + 6 tax + 40 secondaries", () => {
    expect(DD_LAWS.length).toBe(109);
    expect(DD_LAWS.filter((l) => l.kind === "primary").length).toBe(63);
    expect(DD_LAWS.filter((l) => l.kind === "tax").length).toBe(6);
    expect(DD_LAWS.filter((l) => l.kind === "secondary").length).toBe(40);
  });

  it("spot-check: product-levy slider is the revenue anchor at 28", () => {
    const law = DD_LAWS.find((l) => l.id === "dd.tax.salesTax")!;
    expect(law.title).toBe("Product Levy Act");
    expect(law.taxPolicy).toMatchObject({
      taxType: "salesTax",
      minRate: 0,
      maxRate: 45,
      step: 1,
      baselineRate: 28,
    });
  });

  it("spot-check: unified insurance primary is L2 with statePensions key and a reformTitle", () => {
    const law = DD_LAWS.find((l) => l.id === "dd.health.socialInsurance.primary")!;
    expect(law.baselineLevel).toBe(2);
    expect(law.budgetKeyOverride).toBe("statePensions");
    expect(law.reformTitle).toBe("Universal Pensions Act");
  });

  it("spot-check: 1953 texture — the KVP is L2 and the uranium directorate L3", () => {
    expect(DD_LAWS.find((l) => l.id === "dd.defense.armedForces.primary")!.baselineLevel).toBe(2);
    expect(DD_LAWS.find((l) => l.id === "dd.sec.atomicProgramme")!.title).toBe(
      "Uranium Mining Directorate Act"
    );
    expect(DD_LAWS.find((l) => l.id === "dd.sec.atomicProgramme")!.baselineLevel).toBe(3);
  });

  it("carries exactly the 11 reformTitle laws (RU-parity reform set)", () => {
    expect(DD_LAWS.filter((l) => l.reformTitle).length).toBe(11);
  });

  it("cost topology matches RU law-for-law (both NMP command economies)", () => {
    const fractions = (laws: typeof RU_LAWS) =>
      laws
        .filter((l) => l.kind !== "tax")
        .map((l) =>
          (l.levels ?? [])
            .map(
              (lv) =>
                `${lv.gdpCostFraction ?? 0}|${lv.incomeCostFraction ?? 0}|${lv.gdpRevenueFraction ?? 0}`
            )
            .join(",")
        );
    expect(fractions(DD_LAWS)).toEqual(fractions(RU_LAWS));
  });
});
