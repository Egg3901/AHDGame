import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { publishFederationRelocations, type FederationRelocationRecord } from "./relocationLedger";
import { stageFederationFacilityClaims } from "./facilityClaimLedger";

const applicationId = "1991-default:split:1";
const input = {
  applicationId,
  residents: [
    {
      characterId: "person-1",
      successorEntityId: "SK",
      status: "pending-choice" as const,
      formerCountryId: "CS" as const,
      formerHomeState: "SLOVAKIA",
    },
  ],
  firms: [
    {
      corporationId: "firm-1",
      status: "pending-headquarters" as const,
      claims: [
        {
          claimId: "split:facility:plant-1",
          corporationId: "firm-1",
          sectorId: "plant-1",
          debtorEntityId: "SK",
          creditorCountryId: null,
          amountAnchor: 1200,
        },
      ],
    },
  ],
  firmOrigins: { "firm-1": { countryId: "CS" as const, stateId: "SLOVAKIA", entityId: "SK" } },
  now: new Date(0),
};

describe("federation protected relocation ledger", () => {
  it("batches one hundred resident records and preserves a later owner choice on retry", async () => {
    const mem = createInMemoryDb();
    const db = mem as unknown as Db;
    mem.seed("federationSettlementApplications", [
      {
        _id: applicationId,
        presetId: "1991-default",
        settlementId: "split",
        revision: 1,
        sourceEntityId: "CS",
        entityIds: ["CS", "SK"],
        status: "applied",
        appliedOnTurn: 96,
      },
    ]);
    mem.seed("worldEntityStates", [
      { _id: "1991-default:CS", applicationId, entityId: "CS", appliedOnTurn: 96 },
      { _id: "1991-default:SK", applicationId, entityId: "SK", appliedOnTurn: 96 },
    ]);
    const residents = Array.from({ length: 100 }, (_, index) => ({
      ...input.residents[0],
      characterId: `person-${index}`,
    }));
    const collection = db.collection<FederationRelocationRecord>("federationRelocations");
    const bulk = vi.spyOn(collection, "bulkWrite");
    const find = vi.spyOn(collection, "find");
    const first = await publishFederationRelocations({
      ...input,
      db,
      residents,
      firms: [],
      firmOrigins: {},
    });
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledTimes(1);
    expect(first.map((row) => row.subjectId)).toEqual(residents.map((row) => row.characterId));
    await collection.updateOne(
      { _id: first[0]._id },
      { $set: { status: "selected", destination: { countryId: "PL", stateId: "MAZ" } } }
    );
    const replay = await publishFederationRelocations({
      ...input,
      db,
      residents,
      firms: [],
      firmOrigins: {},
      now: new Date(1),
    });
    expect(replay[0]).toMatchObject({
      status: "selected",
      destination: { countryId: "PL", stateId: "MAZ" },
      createdAt: new Date(0),
    });
    expect(replay.slice(1)).toEqual(first.slice(1));
    expect(await collection.countDocuments({})).toBe(100);
  });

  it("requires the complete applied entity receipt", async () => {
    const mem = createInMemoryDb();
    const db = mem as unknown as Db;
    await expect(publishFederationRelocations({ db, ...input })).rejects.toThrow(
      "awaits its applied settlement"
    );
    mem.seed("federationSettlementApplications", [
      {
        _id: applicationId,
        presetId: "1991-default",
        settlementId: "split",
        revision: 1,
        sourceEntityId: "CS",
        entityIds: ["CS", "SK"],
        status: "applied",
        appliedOnTurn: 96,
      },
    ]);
    await expect(publishFederationRelocations({ db, ...input })).rejects.toThrow(
      "missing entity states"
    );
    expect(await db.collection("federationRelocations").countDocuments({})).toBe(0);
  });

  it("preserves pending people and firms and their compensation claim identities on retry", async () => {
    const mem = createInMemoryDb();
    const db = mem as unknown as Db;
    mem.seed("federationSettlementApplications", [
      {
        _id: applicationId,
        presetId: "1991-default",
        settlementId: "split",
        revision: 1,
        sourceEntityId: "CS",
        entityIds: ["CS", "SK"],
        status: "applied",
        appliedOnTurn: 96,
      },
    ]);
    mem.seed("worldEntityStates", [
      { _id: "1991-default:CZ", applicationId, entityId: "CS", appliedOnTurn: 96 },
      { _id: "1991-default:SK", applicationId, entityId: "SK", appliedOnTurn: 96 },
    ]);
    await stageFederationFacilityClaims(db, applicationId, input.firms, new Date(0));
    const first = await publishFederationRelocations({ db, ...input });
    const replay = await publishFederationRelocations({ db, ...input, now: new Date(1) });
    expect(replay).toEqual(first);
    expect(first).toMatchObject([
      { kind: "resident", status: "pending-choice", formerState: "SLOVAKIA" },
      { kind: "firm", status: "pending-choice", claimIds: ["split:facility:plant-1"] },
    ]);
    expect(await db.collection("federationRelocations").countDocuments({})).toBe(2);
    await expect(
      publishFederationRelocations({
        db,
        ...input,
        firmOrigins: {
          "firm-1": { countryId: "CS", stateId: "PRAGUE", entityId: "CZ2" },
        },
      })
    ).rejects.toThrow("conflicts with an earlier record");
  });
});
