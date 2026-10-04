import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { loadLegacyServiceSnapshots } from "./legacyServiceSnapshot";

describe("public legacy settlement finances", () => {
  it("shows continuing issuer contributions without labeling them an administration overdraft", async () => {
    const db = createInMemoryDb();
    db.seed("federationSettlementApplications", [
      { _id: "ru", presetId: "1991-default", status: "applied", sourceEntityId: "RU" },
    ]);
    db.seed("federationContinuingServiceTurns", [
      {
        _id: "ru-1",
        applicationId: "ru",
        turn: 1,
        creditorDueMinor: 100,
        issuerOwnShareMinor: 60,
        issuerCashAfterContributionsMinor: 200,
        successorContributionsMinor: { UKR: 30 },
        successorArrearsMinor: { UKR: 10 },
      },
    ]);
    expect(await loadLegacyServiceSnapshots(db as unknown as Db, "1991-default")).toEqual([
      {
        servicingKind: "continuing-state",
        sourceCountryId: "RU",
        sourceName: "Soviet Union",
        turn: 1,
        creditorDueMinor: 100,
        issuerOwnShareMinor: 60,
        bridgeOutstandingMinor: 0,
        administrationCashAfterMinor: 200,
        successors: [{ entityId: "UKR", name: "Ukraine", contributionMinor: 30, arrearsMinor: 10 }],
      },
    ]);
  });
  it("shows only the latest committed application and preserves signed cash and arrears", async () => {
    const db = createInMemoryDb();
    db.seed("federationSettlementApplications", [
      { _id: "cs", presetId: "1991-default", status: "applied", sourceEntityId: "CS" },
      { _id: "yu", presetId: "1991-default", status: "applied", sourceEntityId: "YU" },
      { _id: "pending", presetId: "1991-default", status: "prepared", sourceEntityId: "RU" },
    ]);
    const receipt = {
      creditorDueMinor: 150,
      bridgeOutstandingMinor: 150,
      administrationCashAfterMinor: -150,
      successorContributionsMinor: { CZ2: 0, SK: 0 },
      successorArrearsMinor: { CZ2: 100, SK: 50 },
      createdAt: new Date(0),
      internalOnly: "omit",
    };
    db.seed("federationLegacyServiceTurns", [
      { ...receipt, _id: "cs-1", applicationId: "cs", turn: 1, bridgeOutstandingMinor: 0 },
      { ...receipt, _id: "cs-2", applicationId: "cs", turn: 2 },
      { ...receipt, _id: "yu-1", applicationId: "yu", turn: 1 },
      { ...receipt, _id: "pending-3", applicationId: "pending", turn: 3 },
    ]);
    const snapshots = await loadLegacyServiceSnapshots(db as unknown as Db, "1991-default");
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual({
      sourceCountryId: "CS",
      sourceName: "Czechoslovakia",
      turn: 2,
      creditorDueMinor: 150,
      bridgeOutstandingMinor: 150,
      administrationCashAfterMinor: -150,
      successors: [
        { entityId: "CZ2", name: "Czechia", contributionMinor: 0, arrearsMinor: 100 },
        { entityId: "SK", name: "Slovakia", contributionMinor: 0, arrearsMinor: 50 },
      ],
    });
    expect(snapshots[1].sourceCountryId).toBe("YU");
    expect(await loadLegacyServiceSnapshots(db as unknown as Db, "1953-default")).toEqual([]);
  });
});
