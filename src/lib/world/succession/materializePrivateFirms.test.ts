import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { PrivateSuccessionFirm, PrivateFirmSuccessionPlan } from "./rules/privateFacilities";
import { materializeFederationPrivateFirms } from "./materializePrivateFirms";

function volumeFixture(count = 100) {
  const mem = createInMemoryDb();
  const applicationId = "volume";
  const firms: PrivateSuccessionFirm[] = [];
  const plans: PrivateFirmSuccessionPlan[] = [];
  const corporations = [];
  const archives = [];
  const claims = [];
  for (let index = 0; index < count; index++) {
    const id = new ObjectId();
    const sectorId = new ObjectId();
    const corporationId = id.toHexString();
    const claimId = `facility:${sectorId}`;
    corporations.push({
      _id: id,
      countryId: "RU",
      headquartersState: "KYIV",
      liquidCapital: 100 + index,
      suspended: index === 0,
      ...(index === 0 ? { ceoType: "npp", caretakerCeo: { appointedBy: "owner" } } : {}),
    });
    firms.push({
      corporationId,
      countryId: "RU",
      headquartersState: "KYIV",
      headquartersRegionId: "UKRAINE",
      facilities: [
        { sectorId: sectorId.toHexString(), regionId: "UKRAINE", bookValueAnchor: 1200 },
      ],
    });
    const claim = {
      claimId,
      corporationId,
      sectorId: sectorId.toHexString(),
      debtorEntityId: "UKR",
      creditorCountryId: null,
      amountAnchor: 1200,
    };
    plans.push({ corporationId, status: "pending-headquarters", claims: [claim] });
    archives.push({
      _id: `${applicationId}:corporateSectors:${sectorId}`,
      applicationId,
      successorEntityId: "UKR",
      value: { corporationId: id },
    });
    claims.push({
      ...claim,
      _id: `${applicationId}:${claimId}`,
      applicationId,
      status: "contingent",
    });
  }
  mem.seed("corporations", corporations);
  mem.seed("federationArchivedRegionRows", archives);
  mem.seed("federationFacilityClaims", claims);
  const input = {
    db: mem as unknown as Db,
    session: { inTransaction: () => true } as ClientSession,
    applicationId,
    sourceCountryId: "RU" as const,
    firms,
    plans,
    transfers: [
      {
        stateId: "KYIV",
        parentRegionId: "UKRAINE",
        topLevelRegionId: "UKRAINE",
        successorEntityId: "UKR",
        leavesDetailedSource: true,
      },
    ],
  };
  return { mem, input };
}

describe("federation player firm protection", () => {
  it("preserves a player firm while its background facilities become claims and its HQ awaits choice", async () => {
    const mem = createInMemoryDb();
    const corporationId = new ObjectId("000000000000000000000081");
    const sectorId = new ObjectId("000000000000000000000082");
    const applicationId = "1991-default:ussr-split:1";
    const claimId = "ussr-split:facility:" + sectorId.toString();
    mem.seed("corporations", [
      { _id: corporationId, countryId: "RU", headquartersState: "KYIV", suspended: false },
    ]);
    mem.seed("federationArchivedRegionRows", [
      {
        _id: `${applicationId}:corporateSectors:${sectorId.toString()}`,
        applicationId,
        successorEntityId: "UKR",
        value: { _id: sectorId, corporationId, stateId: "KYIV" },
      },
    ]);
    mem.seed("federationFacilityClaims", [
      {
        _id: `${applicationId}:${claimId}`,
        applicationId,
        claimId,
        corporationId: corporationId.toString(),
        status: "contingent",
        amountAnchor: 1200,
      },
    ]);
    const db = mem as unknown as Db;
    const origins = await materializeFederationPrivateFirms({
      db,
      session: { inTransaction: () => true } as ClientSession,
      applicationId,
      sourceCountryId: "RU",
      firms: [
        {
          corporationId: corporationId.toString(),
          countryId: "RU",
          headquartersState: "KYIV",
          headquartersRegionId: "UKRAINE",
          facilities: [
            { sectorId: sectorId.toString(), regionId: "UKRAINE", bookValueAnchor: 1200 },
          ],
        },
      ],
      plans: [
        {
          corporationId: corporationId.toString(),
          status: "pending-headquarters",
          claims: [
            {
              claimId,
              corporationId: corporationId.toString(),
              sectorId: sectorId.toString(),
              debtorEntityId: "UKR",
              creditorCountryId: null,
              amountAnchor: 1200,
            },
          ],
        },
      ],
      transfers: [
        {
          stateId: "KYIV",
          parentRegionId: "UKRAINE",
          topLevelRegionId: "UKRAINE",
          successorEntityId: "UKR",
          leavesDetailedSource: true,
        },
      ],
    });
    expect(origins[corporationId.toString()]).toEqual({
      countryId: "RU",
      stateId: "KYIV",
      entityId: "UKR",
      wasSuspended: false,
    });
    expect(
      await db.collection<Corporation>("corporations").findOne({ _id: corporationId })
    ).toMatchObject({
      federationPendingHeadquartersId: applicationId,
      suspended: true,
      headquartersState: "KYIV",
    });
    expect(await db.collection("federationPrivateFirmHolds").countDocuments({})).toBe(1);
  });
  it("protects one hundred firms and facilities with three projected reads and two batch writes", async () => {
    const { mem, input } = volumeFixture();
    const firms = mem.collection("corporations");
    const archives = mem.collection("federationArchivedRegionRows");
    const claims = mem.collection("federationFacilityClaims");
    const firmRead = vi.spyOn(firms, "find");
    const archiveRead = vi.spyOn(archives, "find");
    const claimRead = vi.spyOn(claims, "find");
    const firmWrite = vi.spyOn(firms, "bulkWrite");
    const holdWrite = vi.spyOn(mem.collection("federationPrivateFirmHolds"), "insertMany");
    const origins = await materializeFederationPrivateFirms(input);
    for (const read of [firmRead, archiveRead, claimRead]) {
      expect(read).toHaveBeenCalledOnce();
      expect(read).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ session: input.session, projection: expect.any(Object) })
      );
    }
    expect(firmWrite).toHaveBeenCalledOnce();
    expect(holdWrite).toHaveBeenCalledOnce();
    expect(firms.docs.every((row) => row.federationPendingHeadquartersId === "volume")).toBe(true);
    expect(firms.docs.map((row) => row.liquidCapital)).toEqual(
      Array.from({ length: 100 }, (_, i) => 100 + i)
    );
    expect(Object.keys(origins)).toHaveLength(100);
    expect(origins[input.firms[0].corporationId].wasSuspended).toBe(true);
    expect(mem.collection("federationPrivateFirmHolds").docs).toHaveLength(100);
  });

  it.each(["missing firm", "wrong claim", "wrong successor"])(
    "rejects a last-row %s before protecting any firm",
    async (defect) => {
      const { mem, input } = volumeFixture(2);
      if (defect === "missing firm") mem.collection("corporations").docs.pop();
      if (defect === "wrong claim")
        mem.collection("federationFacilityClaims").docs[1].amountAnchor = 1;
      if (defect === "wrong successor")
        mem.collection("federationArchivedRegionRows").docs[1].successorEntityId = "OTHER";
      await expect(materializeFederationPrivateFirms(input)).rejects.toThrow(
        /changed|compensation/
      );
      expect(mem.collection("federationPrivateFirmHolds").docs).toEqual([]);
      expect(
        mem
          .collection("corporations")
          .docs.every((row) => row.federationPendingHeadquartersId == null)
      ).toBe(true);
    }
  );

  it("requires a transaction and rejects duplicate plans and claims", async () => {
    const { mem, input } = volumeFixture(2);
    await expect(
      materializeFederationPrivateFirms({
        ...input,
        session: { inTransaction: () => false } as ClientSession,
      })
    ).rejects.toThrow("transaction");
    await expect(
      materializeFederationPrivateFirms({ ...input, plans: [...input.plans, input.plans[0]] })
    ).rejects.toThrow("inventory");
    input.plans[1].claims.push(input.plans[0].claims[0]);
    await expect(materializeFederationPrivateFirms(input)).rejects.toThrow("duplicate");
    expect(mem.collection("federationPrivateFirmHolds").docs).toEqual([]);
  });
});
