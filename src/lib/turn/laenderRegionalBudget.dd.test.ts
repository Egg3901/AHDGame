/**
 * DD on the Länder revenue-sharing model.
 *
 * This path was wrong twice before it was right, and both failures were silent:
 * the shares computed to zero and the Länder simply looked poor. So the guards
 * here are about the two things that actually broke.
 *
 *   1. DD's national tax book is the v2 `dd.tax.*` catalogue, not DE's `de_*`
 *      option ladders. Reading DE's ids against DD finds nothing.
 *   2. Those laws are tax SLIDERS: the rate lives in a synthetic `rate:<value>`
 *      option id that matches no seeded `policyOptions` entry, so even the right
 *      ids resolve to 0 without parsing the id itself.
 *
 * Either one alone collapses every Land's budget to the equalization grant, and
 * the austerity path then strips a policy tier from each of them every turn
 * (#1323).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/subsidies/subsidyBudgetCosts", () => ({
  loadAnnualSubsidyCostMaps: vi.fn().mockResolvedValue({ stateCostByStateId: new Map() }),
}));

/** DD's live shape: a slider law with NO seeded policyOptions. */
const DD_INCOME_TAX = {
  _id: "dd.tax.incomeTax",
  taxSlider: { scope: "federal", taxType: "incomeTax", minRate: 0, maxRate: 60, step: 1 },
  policyOptions: [],
};
const DD_SALES_TAX = {
  _id: "dd.tax.salesTax",
  taxSlider: { scope: "federal", taxType: "salesTax", minRate: 0, maxRate: 45, step: 1 },
  policyOptions: [],
};

describe("processLaenderRegionalBudgets for DD", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function wire(nationalPolicies: unknown[]) {
    const setup = <T>(name: string, data: T[]) => {
      db.collection(name);
      db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
        toArray: vi.fn().mockResolvedValue(data),
      });
      db.collectionMocks[name]!.findOne = vi.fn().mockResolvedValue(null);
      db.collectionMocks[name]!.bulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    };
    setup("states", [{ _id: "NW", countryId: "DD", population: 15_760_000, gdp: 66_169 }]);
    // `statePolicies` is queried twice: once for the regions, once for
    // `dd_national`. The mock returns the same set both times, and only the
    // national ids are looked up below, so the regional pass sees no policies.
    setup("statePolicies", nationalPolicies);
    setup("legislationTypes", [DD_INCOME_TAX, DD_SALES_TAX]);
    setup("regionalBudgets", []);
    setup("macroMetrics", [{ _id: "NW", economic: { medianIncome: { value: 9_000 } } }]);
    setup("cabinetSettings", []);
    db.collection.mockImplementation((name: string) => db.collectionMocks[name]);
  }

  /** The rates DD actually runs on live. */
  const LIVE_DD_POLICIES = [
    { stateId: "dd_national", legislationTypeId: "dd.tax.incomeTax", policyOptionId: "rate:35" },
    { stateId: "dd_national", legislationTypeId: "dd.tax.salesTax", policyOptionId: "rate:32" },
  ];

  it("funds a Land from its own slider-set tax rates", async () => {
    wire(LIVE_DD_POLICIES);
    const { processLaenderRegionalBudgets } = await import("./deRegionalBudget");
    const out = await processLaenderRegionalBudgets(db as unknown as Db, "DD", 600, "1953-default");
    expect(out.regionsProcessed).toBe(1);

    const doc = db.collectionMocks.regionalBudgets!.bulkWrite.mock.calls[0][0][0].updateOne.update
      .$set as Record<string, number | string>;

    // The two shares the bug zeroed. Both must be real money.
    expect(doc.incomeTaxShare).toBeGreaterThan(0);
    expect(doc.vatShare).toBeGreaterThan(0);
    // And the grant must not be the only thing funding the Land — that is
    // precisely the collapsed state this guards against.
    expect(Number(doc.incomeTaxShare) + Number(doc.vatShare)).toBeGreaterThan(
      Number(doc.federalEqualizationGrant)
    );
    expect(doc.countryId).toBe("DD");
  });

  it("collapses to the grant alone when the slider id cannot be read", async () => {
    // The regression itself: an option id that is not the synthetic slider form
    // resolves to no seeded option, so both rates read 0. Asserting the FAILURE
    // shape proves the passing test above is actually exercising the parse.
    wire([
      { stateId: "dd_national", legislationTypeId: "dd.tax.incomeTax", policyOptionId: "opt_3" },
      { stateId: "dd_national", legislationTypeId: "dd.tax.salesTax", policyOptionId: "opt_6" },
    ]);
    const { processLaenderRegionalBudgets } = await import("./deRegionalBudget");
    await processLaenderRegionalBudgets(db as unknown as Db, "DD", 600, "1953-default");

    const doc = db.collectionMocks.regionalBudgets!.bulkWrite.mock.calls[0][0][0].updateOne.update
      .$set as Record<string, number>;
    expect(doc.incomeTaxShare).toBe(0);
    expect(doc.vatShare).toBe(0);
  });

  it("would find nothing if it read DE's tax ids against DD", async () => {
    // Pins the OTHER half of the bug: DD's catalogue does not contain the `de_*`
    // ids, so a shared lookup table is not enough — it has to be per country.
    const { TAX_TYPE_IDS } = await import("./deRegionalBudget");
    expect(TAX_TYPE_IDS.DD.incomeTax).toBe("dd.tax.incomeTax");
    expect(TAX_TYPE_IDS.DD.vat).toBe("dd.tax.salesTax");
    expect(TAX_TYPE_IDS.DE.incomeTax).not.toBe(TAX_TYPE_IDS.DD.incomeTax);
    expect(LIVE_DD_POLICIES.some((p) => p.legislationTypeId === TAX_TYPE_IDS.DE.incomeTax)).toBe(
      false
    );
  });

  it("keeps every model country declaring which taxes fund it", async () => {
    const { TAX_TYPE_IDS, LAENDER_MODEL_COUNTRIES } = await import("./deRegionalBudget");
    // The roster is derived from the table, so this cannot drift — the guard is
    // here so a future refactor that splits them back apart fails loudly.
    for (const id of LAENDER_MODEL_COUNTRIES) {
      expect(TAX_TYPE_IDS[id as keyof typeof TAX_TYPE_IDS]).toBeTruthy();
    }
    expect(LAENDER_MODEL_COUNTRIES).toContain("DD");
    expect(LAENDER_MODEL_COUNTRIES).toContain("DE");
  });
});
