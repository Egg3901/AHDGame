import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { planSuccessionFinances } from "./rules/financialSettlement";
import { hashSettlementPayload } from "./settlementIntent";
import { materializeLegacyFederationServiceTurn } from "./legacyServiceTurn";
import type { Bond } from "@/lib/db/types/bond";

const applicationId = "1991-default:cs-1992:1";
const session = { inTransaction: () => true } as ClientSession;

function scenario(shortfall = false) {
  const mem = createInMemoryDb();
  const finances = planSuccessionFinances({
    settlementId: "cs-1992",
    sourceEntityId: "CS",
    participants: [
      { entityId: "CZ2", population: 2 },
      { entityId: "SK", population: 1 },
    ],
    financialAssetsMinor: 0,
    creditorDebtMinor: 150000,
  });
  const payload = { activation: { finances } };
  const bondId = new ObjectId();
  mem.seed("federationSettlementApplications", [
    {
      _id: applicationId,
      presetId: "1991-default",
      sourceEntityId: "CS",
      status: "applied",
      appliedOnTurn: 90,
    },
  ]);
  mem.seed("federationSettlementIntents", [
    {
      _id: applicationId,
      settlementId: "cs-1992",
      sourceEntityId: "CS",
      payload,
      payloadHash: hashSettlementPayload(payload),
    },
  ]);
  mem.seed("countryGameStates", [{ _id: "CS", dissolvedTurn: 90 }]);
  mem.seed("federalBudget", [
    { _id: "CS", countryId: "CS", currencyCode: "CSK", treasuryBalance: 0 },
  ]);
  mem.seed("federationFiscalAccounts", [
    {
      _id: `${applicationId}:CS`,
      applicationId,
      entityId: "CS",
      kind: "legacy-administration",
      remainingContributionMinor: 0,
    },
    {
      _id: `${applicationId}:CZ2`,
      applicationId,
      entityId: "CZ2",
      kind: "background-successor",
      remainingContributionMinor: 100000,
    },
    {
      _id: `${applicationId}:SK`,
      applicationId,
      entityId: "SK",
      kind: "background-successor",
      remainingContributionMinor: 50000,
    },
  ]);
  mem.seed(
    "macroCountries",
    ["CZ2", "SK"].map((id) => ({
      _id: id,
      entityId: id,
      presetId: "1991-default",
      simulationTier: "background-macro",
      dataQuality: { provenance: "succession-derived" },
      federationTreasuryMinor: shortfall ? -1000 : 1000,
      fiscalCapacity: 0.5,
      stability: 0.8,
      sectors: { manufacturing: { capacity: 100, productivity: 1, domesticDemand: 80 } },
    }))
  );
  mem.seed("bonds", [
    {
      _id: bondId,
      issuerType: "sovereign",
      countryId: "CS",
      currencyCode: "CSK",
      couponRate: 4.8,
      maturityTurn: 240,
      holders: [{ units: 2 }],
      publicFloat: 1,
      totalIssued: 3000,
      matured: false,
      defaulted: false,
    },
  ]);
  mem.seed("exchangeRates", [{ _id: "CSK", currencyCode: "CSK", rate: 2 }]);
  return { db: mem as unknown as Db, bondId };
}

describe("legacy federation service transaction", () => {
  it("funds the bond turn's frozen holder snapshot when later placements change live float", async () => {
    const { db, bondId } = scenario();
    const snapshot = await db.collection<Bond>("bonds").find({ matured: false }).toArray();
    await db
      .collection<Bond>("bonds")
      .updateOne({ _id: bondId }, { $set: { publicFloat: 2, totalIssued: 4000 } });
    const receipt = await materializeLegacyFederationServiceTurn({
      db,
      session,
      applicationId,
      turn: 91,
      now: new Date(1000),
      bondSnapshot: snapshot,
    });
    expect(receipt.creditorDueMinor).toBe(150);
  });
  it("funds unchanged creditor payments from both successors once", async () => {
    const { db, bondId } = scenario();
    const args = { db, session, applicationId, turn: 91, now: new Date(1000) };
    const receipt = await materializeLegacyFederationServiceTurn(args);
    expect(receipt).toMatchObject({
      creditorDueMinor: 150,
      successorContributionsMinor: { CZ2: 100, SK: 50 },
      bridgeOutstandingMinor: 0,
      administrationCashAfterMinor: 0,
    });
    expect(await db.collection("macroCountries").findOne({ _id: "CZ2" as never })).toMatchObject({
      federationTreasuryMinor: 980,
    });
    expect(await db.collection("bonds").findOne({ _id: bondId })).toMatchObject({
      countryId: "CS",
      currencyCode: "CSK",
      matured: false,
    });
    expect(await materializeLegacyFederationServiceTurn(args)).toEqual(receipt);
    expect(await db.collection("federationLegacyServiceTurns").countDocuments({})).toBe(1);
  });

  it("records a bounded risk hit and explicit bridge when successors cannot pay", async () => {
    const { db } = scenario(true);
    const receipt = await materializeLegacyFederationServiceTurn({
      db,
      session,
      applicationId,
      turn: 91,
      now: new Date(1000),
    });
    expect(receipt).toMatchObject({
      creditorDueMinor: 150,
      successorContributionsMinor: { CZ2: 0, SK: 0 },
      successorArrearsMinor: { CZ2: 100, SK: 50 },
      bridgeOutstandingMinor: 150,
      administrationCashAfterMinor: -150,
    });
    expect(await db.collection("macroCountries").findOne({ _id: "SK" as never })).toMatchObject({
      stability: 0.78,
    });
    expect(await db.collection("federalBudget").findOne({ _id: "CS" as never })).toMatchObject({
      treasuryBalance: -3,
    });
    await db
      .collection("macroCountries")
      .updateMany({}, { $set: { federationTreasuryMinor: 1000 } });
    const recovered = await materializeLegacyFederationServiceTurn({
      db,
      session,
      applicationId,
      turn: 92,
      now: new Date(2000),
    });
    expect(recovered).toMatchObject({
      creditorDueMinor: 150,
      successorContributionsMinor: { CZ2: 200, SK: 100 },
      bridgeOutstandingMinor: 0,
      administrationCashAfterMinor: 0,
    });
  });
});
