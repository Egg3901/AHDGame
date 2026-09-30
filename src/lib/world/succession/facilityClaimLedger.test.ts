import { type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  activateFederationFacilityClaim,
  stageFederationFacilityClaims,
} from "./facilityClaimLedger";
import type { PrivateFirmSuccessionPlan } from "./rules/privateFacilities";

const plan: PrivateFirmSuccessionPlan = {
  corporationId: "firm-1",
  status: "pending-headquarters",
  claims: [
    {
      claimId: "settlement:facility:plant-1",
      corporationId: "firm-1",
      sectorId: "plant-1",
      debtorEntityId: "UA",
      creditorCountryId: null,
      amountAnchor: 1200,
    },
    {
      claimId: "settlement:facility:plant-2",
      corporationId: "firm-1",
      sectorId: "plant-2",
      debtorEntityId: "BY",
      creditorCountryId: null,
      amountAnchor: 300,
    },
  ],
};

describe("contingent facility claim ledger", () => {
  it("stages exactly one claim per facility across a repeated application", async () => {
    const mem = createInMemoryDb();
    const db = mem as unknown as Db;
    const first = await stageFederationFacilityClaims(db, "1991:split:1", [plan], new Date(0));
    const replay = await stageFederationFacilityClaims(db, "1991:split:1", [plan], new Date(1));
    expect(replay).toEqual(first);
    expect(await db.collection("federationFacilityClaims").find({}).toArray()).toHaveLength(2);
    expect(first.every((claim) => claim.status === "contingent")).toBe(true);
  });

  it("rejects changed amounts and destination routing under the same key", async () => {
    const mem = createInMemoryDb();
    const db = mem as unknown as Db;
    await stageFederationFacilityClaims(db, "1991:split:1", [plan], new Date(0));
    await expect(
      stageFederationFacilityClaims(
        db,
        "1991:split:1",
        [{ ...plan, claims: [{ ...plan.claims[0], amountAnchor: 1500 }] }],
        new Date(1)
      )
    ).rejects.toThrow("conflicts");
  });

  it("rejects duplicate liabilities before any write", async () => {
    const mem = createInMemoryDb();
    await expect(
      stageFederationFacilityClaims(
        mem as unknown as Db,
        "1991:split:1",
        [{ ...plan, claims: [plan.claims[0], plan.claims[0]] }],
        new Date(0)
      )
    ).rejects.toThrow("duplicate liabilities");
    expect(
      await (mem as unknown as Db).collection("federationFacilityClaims").find({}).toArray()
    ).toHaveLength(0);
  });

  it("requires an applied settlement and an explicit creditor before making a claim payable", async () => {
    const mem = createInMemoryDb();
    const db = mem as unknown as Db;
    await stageFederationFacilityClaims(db, "1991:split:1", [plan], new Date(0));
    await expect(
      activateFederationFacilityClaim(db, "1991:split:1", plan.claims[0].claimId, "firm-1", "RU")
    ).rejects.toThrow("before its settlement");
    mem.seed("federationSettlementApplications", [{ _id: "1991:split:1", status: "applied" }]);
    const payable = await activateFederationFacilityClaim(
      db,
      "1991:split:1",
      plan.claims[0].claimId,
      "firm-1",
      "RU"
    );
    expect(payable).toMatchObject({ status: "payable", creditorCountryId: "RU" });
    expect(
      await activateFederationFacilityClaim(
        db,
        "1991:split:1",
        plan.claims[0].claimId,
        "firm-1",
        "RU"
      )
    ).toEqual(payable);
    await expect(
      activateFederationFacilityClaim(db, "1991:split:1", plan.claims[0].claimId, "firm-1", "PL")
    ).rejects.toThrow("another creditor");
  });
});
