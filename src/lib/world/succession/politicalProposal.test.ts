import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { planSuccessionFinances } from "./rules/financialSettlement";
import type { SuccessionActivationInput } from "./planActivation";
import { openFederationPoliticalProposal } from "./politicalProposal";
import { hashFederationPoliticalTerms } from "./settlementIntent";

function scenario(currentYear = 1991) {
  const mem = createInMemoryDb();
  mem.seed("gameState", [{ _id: "current", preset: "1991-default", currentYear, currentTurn: 96 }]);
  mem.seed("states", [
    { _id: "RUSSIA", countryId: "RU", population: 10, gdp: 100 },
    { _id: "UKRAINE", countryId: "RU", population: 11, gdp: 101 },
  ]);
  const territories = [
    { entityId: "RU", regionIds: ["RUSSIA"], population: 10, annualGdpAnchor: 100 },
    { entityId: "UKR", regionIds: ["UKRAINE"], population: 11, annualGdpAnchor: 101 },
  ];
  const activation: Omit<SuccessionActivationInput, "sourceRegions" | "custodyAssets"> = {
    settlementId: "ussr-1",
    approval: {
      settlementId: "ussr-1",
      revision: 1,
      availableFromYear: 1991,
      currentYear,
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
  };
  return {
    mem,
    input: {
      db: mem as unknown as Db,
      sourceCountryId: "RU" as const,
      activation,
      now: new Date(0),
    },
  };
}

describe("1991 federation political proposal", () => {
  it("opens one normal vote and replays without creating a second bill", async () => {
    const { input } = scenario();
    const proposal = await openFederationPoliticalProposal(input);
    const replay = await openFederationPoliticalProposal({ ...input, now: new Date(1000) });
    expect(replay).toEqual(proposal);
    expect(proposal.status).toBe("open");
    expect(proposal.termsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await input.db.collection("bills").find({}).toArray()).toMatchObject([
      {
        _id: proposal.billId,
        countryId: "RU",
        status: "active",
        votingEndsOnTurn: 120,
        federationSettlementMandate: { termsHash: proposal.termsHash },
      },
    ]);
  });

  it("repairs a proposal whose bill insertion was interrupted", async () => {
    const { input } = scenario();
    const proposal = await openFederationPoliticalProposal(input);
    await input.db.collection("bills").deleteOne({ _id: proposal.billId });
    const recovered = await openFederationPoliticalProposal(input);
    expect(recovered.billId).toEqual(proposal.billId);
    expect(await input.db.collection("bills").find({}).toArray()).toHaveLength(1);
  });

  it("opens no bill before the historical decision year", async () => {
    const { input } = scenario(1990);
    await expect(openFederationPoliticalProposal(input)).rejects.toThrow("unavailable");
    expect(await input.db.collection("bills").find({}).toArray()).toHaveLength(0);
  });

  it("rejects a second set of terms under the same revision", async () => {
    const { input } = scenario();
    await openFederationPoliticalProposal(input);
    const changed = {
      ...input.activation,
      continuingDisplayName: "Russian Confederation",
    };
    await expect(
      openFederationPoliticalProposal({ ...input, activation: changed })
    ).rejects.toThrow("conflicts");
    expect(await input.db.collection("bills").find({}).toArray()).toHaveLength(1);
  });

  it("keeps population-default consent valid when the population changes", () => {
    const { input } = scenario();
    const territories = input.activation.territories.map((row) =>
      row.entityId === "RU" ? { ...row, population: row.population + 1 } : row
    );
    const changed = {
      ...input.activation,
      territories,
      finances: planSuccessionFinances({
        settlementId: "ussr-1",
        sourceEntityId: "RU",
        participants: territories.map(({ entityId, population }) => ({ entityId, population })),
        financialAssetsMinor: 100,
        creditorDebtMinor: 200,
      }),
    };
    expect(hashFederationPoliticalTerms(changed)).toBe(
      hashFederationPoliticalTerms(input.activation)
    );
  });
});
