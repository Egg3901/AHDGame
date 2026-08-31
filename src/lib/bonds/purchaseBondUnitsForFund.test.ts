import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import { purchaseBondUnitsForFund } from "./purchaseBondUnitsForFund";

describe("purchaseBondUnitsForFund", () => {
  it("enforces the sovereign per-issue cap before debiting fund cash", async () => {
    const fundId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      faceValue: 1_000,
      totalIssued: 1_000_000,
      publicFloat: 1_000,
      holders: [{ fundId, units: 200 }],
      matured: false,
      defaulted: false,
    } as unknown as Bond;
    const fund = {
      _id: fundId,
      name: "Test Fund",
      quotedNav: 100,
      anchorCurrencyCode: "USD",
    } as IndexFund;
    const collection = vi.fn();

    await expect(
      purchaseBondUnitsForFund({ collection } as unknown as Db, fund, bond, 51)
    ).resolves.toEqual({ ok: false, reason: "position_limit" });
    expect(collection).not.toHaveBeenCalled();
  });
});
