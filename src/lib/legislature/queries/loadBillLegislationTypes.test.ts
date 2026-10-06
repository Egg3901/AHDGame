import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { loadBillLegislationTypes } from "./loadBillLegislationTypes";

describe("loadBillLegislationTypes", () => {
  it("loads one deduplicated catalog slice for legacy and multi-provision bills", async () => {
    const toArray = vi.fn().mockResolvedValue([
      { _id: "us_federal_domestic_corporate_tax_rate", name: "Corporate Tax" },
      { _id: "healthcare", name: "Healthcare" },
    ]);
    const find = vi.fn().mockReturnValue({ toArray });
    const db = { collection: vi.fn().mockReturnValue({ find }) } as unknown as Db;

    const result = await loadBillLegislationTypes(db, [
      {
        legislationTypeId: "us_federal_corporate_tax_rate",
        provisions: [
          { legislationTypeId: "healthcare", effectDirection: 1 },
          { legislationTypeId: "healthcare", effectDirection: -1 },
        ],
      },
    ]);

    expect(find).toHaveBeenCalledWith({
      _id: {
        $in: expect.arrayContaining([
          "us_federal_corporate_tax_rate",
          "us_federal_domestic_corporate_tax_rate",
          "healthcare",
        ]),
      },
    });
    expect(result.get("healthcare")?.name).toBe("Healthcare");
  });

  it("skips the database when no bill references a policy type", async () => {
    const collection = vi.fn();
    const result = await loadBillLegislationTypes({ collection } as unknown as Db, [
      { provisions: [{ type: "tariff", scopeType: "economy_wide", rate: 10 }] },
    ]);

    expect(result.size).toBe(0);
    expect(collection).not.toHaveBeenCalled();
  });
});
