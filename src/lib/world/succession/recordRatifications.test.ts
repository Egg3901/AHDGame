import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { planSuccessionFinances } from "./rules/financialSettlement";
import { openFederationPoliticalProposal } from "./politicalProposal";
import { recordFederationRatifications } from "./recordRatifications";

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
});
