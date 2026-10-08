import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { LegislationType } from "@/lib/db/types/legislation";
import { resolveResetTaxProvisionFields } from "./resolveTaxProvision";

describe("resolveResetTaxProvisionFields", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("federalBudget").findOne.mockResolvedValue({
      _id: "JP",
      taxRates: { foreignCorporateTax: 23 },
    });
  });

  it("resolves a reviewed legacy tax to an exact rate", async () => {
    const result = await resolveResetTaxProvisionFields(
      db as unknown as Db,
      {
        _id: "jp_foreign_corporation_tax",
        taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
        policyOptions: [
          { id: "zero", name: "0%", rate: 0 },
          { id: "maximum", name: "65%", rate: 65 },
        ],
      } as LegislationType,
      27.25,
      undefined,
      "JP",
      "national"
    );

    expect(result).toEqual({
      ok: true,
      fields: expect.objectContaining({
        proposedRate: 27.25,
        policyOptionId: "rate:27.25",
        currentPolicyOptionNameSnapshot: "Rate: 23%",
        policyOptionNameSnapshot: "Rate: 27.25%",
      }),
    });
  });

  it("rejects catalog entries whose stored tax metadata targets another budget field", async () => {
    const result = await resolveResetTaxProvisionFields(
      db as unknown as Db,
      {
        _id: "jp_foreign_corporation_tax",
        taxRateChange: { scope: "federal", taxType: "incomeTax" },
        policyOptions: [
          { id: "zero", name: "0%", rate: 0 },
          { id: "maximum", name: "65%", rate: 65 },
        ],
      } as LegislationType,
      27.25,
      undefined,
      "JP",
      "national"
    );

    expect(result).toEqual({
      ok: false,
      error: "This tax instrument has incompatible rate metadata.",
    });
    expect(db.collectionMocks.federalBudget.findOne).not.toHaveBeenCalled();
  });
});
