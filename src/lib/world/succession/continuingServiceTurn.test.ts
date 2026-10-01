import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { planSuccessionFinances } from "./rules/financialSettlement";
import { hashSettlementPayload } from "./settlementIntent";
import { materializeContinuingFederationServiceTurn } from "./continuingServiceTurn";
const applicationId = "1991-default:su-1991:1";
const session = { inTransaction: () => true } as ClientSession;
function scenario() {
  const mem = createInMemoryDb();
  const oldId = new ObjectId();
  const newId = new ObjectId();
  const finances = planSuccessionFinances({
    settlementId: "su-1991",
    sourceEntityId: "RU",
    participants: [
      { entityId: "RU", population: 2 },
      { entityId: "UA", population: 1 },
      { entityId: "BY", population: 1 },
    ],
    financialAssetsMinor: 0,
    creditorDebtMinor: 150000,
  });
  const payload = {
    activation: { finances },
    plan: { accounting: { creditorPrincipalByBondMinor: { [oldId.toString()]: 150000 } } },
  };
  mem.seed("federationSettlementApplications", [
    {
      _id: applicationId,
      presetId: "1991-default",
      settlementId: "su-1991",
      revision: 1,
      sourceEntityId: "RU",
      status: "applied",
      appliedOnTurn: 90,
    },
  ]);
  mem.seed("federationSettlementIntents", [
    {
      _id: applicationId,
      presetId: "1991-default",
      settlementId: "su-1991",
      revision: 1,
      sourceEntityId: "RU",
      payload,
      payloadHash: hashSettlementPayload(payload),
    },
  ]);
  mem.seed("countryGameStates", [{ _id: "RU", dissolvedTurn: null }]);
  mem.seed("federalBudget", [
    { _id: "RU", countryId: "RU", currencyCode: "RUB", treasuryBalance: 20 },
  ]);
  mem.seed(
    "federationFiscalAccounts",
    ["RU", "UA", "BY"].map((id) => ({
      _id: `${applicationId}:${id}`,
      applicationId,
      entityId: id,
      kind: id === "RU" ? "continuing-state" : "background-successor",
      remainingContributionMinor: id === "RU" ? 75000 : 37500,
    }))
  );
  mem.seed(
    "macroCountries",
    ["UA", "BY"].map((id) => ({
      _id: id,
      entityId: id,
      presetId: "1991-default",
      simulationTier: "background-macro",
      dataQuality: { provenance: "succession-derived" },
      federationTreasuryMinor: 1000,
      fiscalCapacity: 0.5,
      stability: 0.8,
      sectors: { manufacturing: { capacity: 100, productivity: 1, domesticDemand: 80 } },
    }))
  );
  mem.seed(
    "bonds",
    [oldId, newId].map((id) => ({
      _id: id,
      issuerType: "sovereign",
      countryId: "RU",
      currencyCode: "RUB",
      couponRate: 4.8,
      maturityTurn: 240,
      holders: [{ units: 2 }],
      publicFloat: 1,
      totalIssued: 3000,
      matured: false,
      defaulted: false,
    }))
  );
  mem.seed("exchangeRates", [{ _id: "RUB", currencyCode: "RUB", rate: 2 }]);
  return { db: mem as unknown as Db, oldId, newId };
}
function run(db: Db, turn = 91) {
  return materializeContinuingFederationServiceTurn({
    db,
    session,
    applicationId,
    turn,
    now: new Date(1000),
  });
}
describe("continuing federation service transaction", () => {
  it("preserves treasury precision when adding shared-unit contributions", async () => {
    const { db } = scenario();
    await db
      .collection("federalBudget")
      .updateOne({ _id: "RU" as never }, { $set: { treasuryBalance: 20.001 } });
    await run(db);
    expect(await db.collection("federalBudget").findOne({ _id: "RU" as never })).toMatchObject({
      treasuryBalance: 21.501,
    });
  });
  it("does not rewrite later fiscal state by inserting an earlier missing turn", async () => {
    const { db } = scenario();
    await run(db, 92);
    await expect(run(db, 91)).rejects.toThrow("latest committed turn");
    expect(await db.collection("federationContinuingServiceTurns").countDocuments()).toBe(1);
  });
  it("excludes new borrowing and credits only successor payments to the sovereign treasury", async () => {
    const { db } = scenario();
    const result = await run(db);
    expect(result).toMatchObject({
      creditorDueMinor: 150,
      issuerOwnShareMinor: 75,
      successorContributionsMinor: { BY: 38, UA: 37 },
      successorArrearsMinor: { BY: 0, UA: 0 },
      issuerCashAfterContributionsMinor: 1075,
    });
    expect(await db.collection("federalBudget").findOne({ _id: "RU" as never })).toMatchObject({
      treasuryBalance: 21.5,
    });
    expect(await db.collection("bonds").countDocuments()).toBe(2);
    expect(await db.collection("federationLegacyServiceTurns").countDocuments()).toBe(0);
    expect(await run(db)).toEqual(result);
    expect(await db.collection("federationContinuingServiceTurns").countDocuments()).toBe(1);
  });
  it("recovers only the owing successor's arrears on a later turn", async () => {
    const { db } = scenario();
    await db
      .collection("macroCountries")
      .updateOne({ _id: "UA" as never }, { $set: { federationTreasuryMinor: -1000 } });
    expect(await run(db)).toMatchObject({
      successorArrearsMinor: { BY: 0, UA: 37 },
      successorContributionsMinor: { BY: 38, UA: 0 },
    });
    await db
      .collection("macroCountries")
      .updateOne({ _id: "UA" as never }, { $set: { federationTreasuryMinor: 1000 } });
    expect(await run(db, 92)).toMatchObject({
      successorArrearsMinor: { BY: 0, UA: 0 },
      successorContributionsMinor: { BY: 38, UA: 74 },
    });
  });
  it("recovers arrears after maturity without calling successors for new Russian bonds", async () => {
    const { db, oldId } = scenario();
    await db
      .collection("macroCountries")
      .updateOne({ _id: "UA" as never }, { $set: { federationTreasuryMinor: -1000 } });
    await run(db);
    await db.collection("bonds").updateOne({ _id: oldId }, { $set: { matured: true } });
    await db
      .collection("macroCountries")
      .updateOne({ _id: "UA" as never }, { $set: { federationTreasuryMinor: 1000 } });
    expect(await run(db, 92)).toMatchObject({
      creditorDueMinor: 0,
      issuerOwnShareMinor: 0,
      successorContributionsMinor: { BY: 0, UA: 37 },
      successorArrearsMinor: { BY: 0, UA: 0 },
    });
  });
  it("requires an active transaction and an unchanged approved contract inventory", async () => {
    const { db } = scenario();
    await expect(
      materializeContinuingFederationServiceTurn({
        db,
        session: { inTransaction: () => false } as ClientSession,
        applicationId,
        turn: 91,
        now: new Date(),
      })
    ).rejects.toThrow("transaction");
    await db
      .collection("federationSettlementIntents")
      .updateOne({ _id: applicationId as never }, { $set: { payloadHash: "changed" } });
    await expect(run(db)).rejects.toThrow("unchanged");
    expect(await db.collection("federationContinuingServiceTurns").countDocuments()).toBe(0);
  });
});
