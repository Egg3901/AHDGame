import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { planSuccessionFinances } from "./rules/financialSettlement";
import { openFederationPoliticalProposal } from "./politicalProposal";
import { recordFederationRatifications } from "./recordRatifications";
import { processFederationRatifications } from "@/lib/turn/federationRatifications";
import { buildRatifiedFederationActivation } from "./buildRatifiedActivation";
import { planLiveSuccessionActivation } from "./planActivation";

async function scenario() {
  const mem = createInMemoryDb();
  mem.seed("gameState", [
    { _id: "current", preset: "1991-default", currentYear: 1991, currentTurn: 96 },
  ]);
  mem.seed("states", [
    { _id: "RUSSIA", countryId: "RU", population: 10, gdp: 100 },
    { _id: "UKRAINE", countryId: "RU", population: 11, gdp: 101 },
  ]);
  mem.seed("macroCountries", [
    {
      _id: "UKR",
      entityId: "UKR",
      presetId: "1991-default",
      stability: 0.7,
      fiscalCapacity: 0.5,
      retiredAt: null,
    },
  ]);
  const db = mem as unknown as Db;
  const territories = [
    { entityId: "RU", regionIds: ["RUSSIA"], population: 10, annualGdpAnchor: 100 },
    { entityId: "UKR", regionIds: ["UKRAINE"], population: 11, annualGdpAnchor: 101 },
  ];
  const proposal = await openFederationPoliticalProposal({
    db,
    sourceCountryId: "RU",
    now: new Date(0),
    activation: {
      settlementId: "ussr-1",
      approval: {
        settlementId: "ussr-1",
        revision: 1,
        availableFromYear: 1991,
        currentYear: 1991,
        requiredParticipants: ["RU", "UKR"],
        parentMandate: null,
        consents: [],
      },
      source: getWorldEntityOrThrow("1991-default", "RU"),
      continuingDisplayName: "Russia",
      successors: [getWorldEntityOrThrow("1991-default", "UKR")],
      territories,
      finances: planSuccessionFinances({
        settlementId: "ussr-1",
        sourceEntityId: "RU",
        participants: territories.map(({ entityId, population }) => ({ entityId, population })),
        financialAssetsMinor: 0,
        creditorDebtMinor: 0,
      }),
      negotiatedCustodians: {},
      macroTerms: {},
      now: new Date(0),
    },
  });
  const args = {
    db,
    sourceCountryId: "RU" as const,
    settlementId: "ussr-1",
    revision: 1,
    currentTurn: 120,
  };
  return { db, proposal, args };
}

describe("federation ratification records", () => {
  it("skips an applied source after its detailed territory has moved", async () => {
    const { db, proposal } = await scenario();
    await db.collection("bills").updateOne(
      { _id: proposal.billId },
      {
        $set: { status: "signed", enactedAt: new Date(1) },
      }
    );
    await db.collection("federationSettlementApplications").insertOne({
      _id: "1991-default:ussr-1:1" as never,
      presetId: "1991-default",
      sourceEntityId: "RU",
      status: "applied",
    });
    await db.collection("states").deleteMany({ countryId: "RU" });
    expect(await processFederationRatifications(db, "1991-default", 121)).toBe(0);
    expect(await db.collection("federationRatifications").countDocuments({})).toBe(0);
  });
  it("runs from the turn path only after the ordinary bill is enacted", async () => {
    const { db, proposal } = await scenario();
    expect(await processFederationRatifications(db, "1991-default", 120)).toBe(0);
    expect(await db.collection("federationRatifications").countDocuments({})).toBe(0);
    await db.collection("bills").updateOne(
      { _id: proposal.billId },
      {
        $set: { status: "signed", enactedAt: new Date(1) },
      }
    );
    expect(await processFederationRatifications(db, "1991-default", 120)).toBe(1);
    expect(await db.collection("federationRatifications").countDocuments({})).toBe(2);
  });

  it("waits for the enacted bill, then persists source and autonomous consent exactly once", async () => {
    const { db, proposal, args } = await scenario();
    await expect(recordFederationRatifications(args)).rejects.toThrow("enacted");
    await db.collection("bills").updateOne(
      { _id: proposal.billId },
      {
        $set: { status: "signed", enactedAt: new Date(1) },
      }
    );
    const first = await recordFederationRatifications(args);
    const replay = await recordFederationRatifications({ ...args, currentTurn: 121 });
    expect(replay).toEqual(first);
    expect(first).toMatchObject([
      { entityId: "RU", mode: "legislative", choice: "approve", billId: proposal.billId },
      { entityId: "UKR", mode: "autonomous", choice: "approve", termsHash: proposal.termsHash },
    ]);
    expect(first.every((row) => row.reason.length > 20)).toBe(true);
  });

  it("records only successor consents when the source federation disappears", async () => {
    const mem = createInMemoryDb();
    mem.seed("gameState", [
      { _id: "current", preset: "1991-default", currentYear: 1992, currentTurn: 180 },
    ]);
    mem.seed("states", [
      { _id: "CZECHLANDS", countryId: "CS", population: 10, gdp: 100 },
      { _id: "SLOVAKIA", countryId: "CS", population: 5, gdp: 50 },
    ]);
    mem.seed("federalBudget", [
      { _id: "CS", countryId: "CS", treasuryBalance: 12, debt: { principal: 0 } },
    ]);
    // Emergent successor economies are not seeded until the split is applied.
    const db = mem as unknown as Db;
    const territories = [
      { entityId: "CZ2", regionIds: ["CZECHLANDS"], population: 10, annualGdpAnchor: 100 },
      { entityId: "SK", regionIds: ["SLOVAKIA"], population: 5, annualGdpAnchor: 50 },
    ];
    const proposal = await openFederationPoliticalProposal({
      db,
      sourceCountryId: "CS",
      now: new Date(0),
      activation: {
        settlementId: "cs-1",
        approval: {
          settlementId: "cs-1",
          revision: 1,
          availableFromYear: 1992,
          currentYear: 1992,
          requiredParticipants: ["CZ2", "SK"],
          parentMandate: null,
          consents: [],
        },
        source: getWorldEntityOrThrow("1991-default", "CS"),
        successors: ["CZ2", "SK"].map((id) => getWorldEntityOrThrow("1991-default", id)),
        territories,
        finances: planSuccessionFinances({
          settlementId: "cs-1",
          sourceEntityId: "CS",
          participants: territories.map(({ entityId, population }) => ({ entityId, population })),
          financialAssetsMinor: 0,
          creditorDebtMinor: 0,
        }),
        negotiatedCustodians: {},
        macroTerms: {},
        now: new Date(0),
      },
    });
    await db.collection("bills").updateOne(
      { _id: proposal.billId },
      {
        $set: { status: "signed", enactedAt: new Date(1) },
      }
    );
    const records = await recordFederationRatifications({
      db,
      sourceCountryId: "CS",
      settlementId: "cs-1",
      revision: 1,
      currentTurn: 181,
    });
    expect(records.map(({ entityId, mode }) => [entityId, mode])).toEqual([
      ["CZ2", "autonomous"],
      ["SK", "autonomous"],
    ]);
    expect(records.map(({ choice }) => choice)).toEqual(["approve", "approve"]);
    expect(await db.collection("macroCountries").countDocuments({})).toBe(0);
    expect(await db.collection("federationRatifications").countDocuments({})).toBe(2);
    const activation = await buildRatifiedFederationActivation({
      db,
      sourceCountryId: "CS",
      settlementId: "cs-1",
      revision: 1,
      currentTurn: 181,
      currentYear: 1992,
      now: new Date(2),
    });
    const planned = await planLiveSuccessionActivation(db, "CS", activation);
    expect(activation.finances.financialAssetsMinor).toBe(1200);
    expect(planned.sourceEntity.status).toBe("dissolved");
    expect(planned.successorEntities.map(({ status }) => status)).toEqual([
      "sovereign",
      "sovereign",
    ]);
    expect(planned.macroCountries.map(({ population }) => population)).toEqual([10, 5]);
    expect(await db.collection("macroCountries").countDocuments({})).toBe(0);
  });
});
