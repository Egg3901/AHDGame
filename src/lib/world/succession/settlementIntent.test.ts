import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { tier3Entry } from "@/lib/world/registry/builders";
import { planSuccessionFinances } from "./rules/financialSettlement";
import {
  buildLiveFederationSettlementSnapshot,
  hashSettlementPayload,
  stageLiveFederationSettlementIntent,
  verifyLiveFederationSettlementIntent,
} from "./settlementIntent";
import type { SuccessionActivationInput } from "./planActivation";

const residentId = new ObjectId("000000000000000000000101");
const firmId = new ObjectId("000000000000000000000102");
const sectorId = new ObjectId("000000000000000000000103");
const bondId = new ObjectId("000000000000000000000104");

function activation(): Omit<SuccessionActivationInput, "sourceRegions" | "custodyAssets"> {
  const source = tier3Entry("1991-default", {
    entityId: "RU",
    displayName: "Soviet Union",
    region: "europe",
    status: "sovereign",
    recognition: { status: "widely-recognized" },
    un: { state: "admitted" },
  });
  const successor = {
    ...tier3Entry("1991-default", {
      entityId: "UKR",
      displayName: "Ukraine",
      region: "europe",
      status: "emergent",
      parentEntityId: "RU",
      recognition: { status: "dependent" },
      un: { state: "ineligible" },
    }),
    simulationTier: "background-macro" as const,
  };
  const territories = [
    { entityId: "RU", regionIds: ["RUSSIA"], population: 10, annualGdpAnchor: 100 },
    { entityId: "UKR", regionIds: ["UKRAINE"], population: 11, annualGdpAnchor: 101 },
  ];
  return {
    settlementId: "ussr-1",
    approval: {
      settlementId: "ussr-1",
      revision: 1,
      availableFromYear: 1991,
      currentYear: 1991,
      requiredParticipants: ["RU", "UKR"],
      parentMandate: { settlementId: "ussr-1", revision: 1 },
      consents: ["RU", "UKR"].map((entityId) => ({
        entityId,
        settlementId: "ussr-1",
        revision: 1,
        choice: "approve" as const,
      })),
    },
    source,
    continuingDisplayName: "Russia",
    successors: [successor],
    territories,
    finances: planSuccessionFinances({
      settlementId: "ussr-1",
      sourceEntityId: "RU",
      participants: territories.map(({ entityId, population }) => ({ entityId, population })),
      financialAssetsMinor: 100,
      creditorDebtMinor: 200,
    }),
    negotiatedCustodians: {},
    macroTerms: {
      UKR: {
        presetId: "1991-default",
        currentTurn: 97,
        economicSystem: "market",
        sourceGdpToGameUnit: 1,
        fiscalCapacity: 0.4,
        stability: 0.6,
        tradeExposure: 0.3,
        sectorWeights: { manufacturing: 1 },
        resources: { timber: 0.5 },
      },
    },
    now: new Date(0),
  };
}

function scenario() {
  const mem = createInMemoryDb();
  mem.seed("states", [
    { _id: "RUSSIA", countryId: "RU", population: 10, gdp: 100 },
    { _id: "UKRAINE", countryId: "RU", population: 11, gdp: 101 },
  ]);
  mem.seed("federalBudget", [
    { _id: "RU", countryId: "RU", treasuryBalance: 1, debt: { principal: 2 } },
  ]);
  mem.seed("bonds", [
    {
      _id: bondId,
      issuerType: "sovereign",
      countryId: "RU",
      totalIssued: 2,
      maturityTurn: 240,
      matured: false,
      defaulted: false,
    },
  ]);
  mem.seed("characters", [{ _id: residentId, countryId: "RU", homeState: "UKRAINE" }]);
  mem.seed("corporations", [{ _id: firmId, countryId: "RU", headquartersState: "UKRAINE" }]);
  mem.seed("corporateSectors", [
    {
      _id: sectorId,
      corporationId: firmId,
      countryId: "RU",
      stateId: "UKRAINE",
      sectorType: "manufacturing",
      capacityBookAnchor: 1000,
      capitalStock: 10,
    },
  ]);
  const args = {
    db: mem as unknown as Db,
    sourceCountryId: "RU" as const,
    activation: activation(),
    appliedOnTurn: 97,
    currentYear: 1991,
    eraUnitScale: 1,
    playableResidences: [{ countryId: "PL" as const, stateId: "MAZ" }],
    residenceChoices: {},
    playableHeadquarters: [{ countryId: "PL" as const, stateId: "MAZ" }],
    headquartersChoices: {},
  };
  return { mem, args };
}

describe("live federation settlement intent", () => {
  it("stages one immutable approved snapshot while leaving every source record untouched", async () => {
    const { args } = scenario();
    const first = await stageLiveFederationSettlementIntent(args);
    const replay = await stageLiveFederationSettlementIntent({
      ...args,
      activation: { ...args.activation, now: new Date(1000) },
    });
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      _id: "1991-default:ussr-1:1",
      status: "staged",
      appliedOnTurn: 97,
    });
    expect(first.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.payload.valuation).toEqual({ currentYear: 1991, eraUnitScale: 1 });
    expect(hashSettlementPayload(first.payload)).toBe(first.payloadHash);
    expect(
      (first.payload.fiscalShares as { facilityClaimLiabilityMinor: number }[])[1]
        .facilityClaimLiabilityMinor
    ).toBeGreaterThan(0);
    expect(await args.db.collection("federationSettlementIntents").find({}).toArray()).toHaveLength(
      1
    );
    expect(await args.db.collection("federationFacilityClaims").find({}).toArray()).toMatchObject([
      {
        _id: "1991-default:ussr-1:1:ussr-1:facility:000000000000000000000103",
        status: "contingent",
      },
    ]);
    expect(
      await args.db.collection("federationSettlementApplications").find({}).toArray()
    ).toHaveLength(0);
    expect((await args.db.collection("characters").findOne({ _id: residentId }))?.countryId).toBe(
      "RU"
    );
    expect(
      (
        await args.db
          .collection<{ _id: string; treasuryBalance: number }>("federalBudget")
          .findOne({ _id: "RU" })
      )?.treasuryBalance
    ).toBe(1);
    expect(await args.db.collection("worldEntityStates").find({}).toArray()).toHaveLength(0);
  });

  it("rebuilds the same live snapshot and binds the valuation and choices to its hash", async () => {
    const { args } = scenario();
    const staged = await stageLiveFederationSettlementIntent(args);
    const rebuilt = await buildLiveFederationSettlementSnapshot(args);
    expect(rebuilt.payloadHash).toBe(staged.payloadHash);
    const changedValuation = await buildLiveFederationSettlementSnapshot({
      ...args,
      eraUnitScale: 2,
    });
    expect(changedValuation.payloadHash).not.toBe(staged.payloadHash);
    const changedChoice = await buildLiveFederationSettlementSnapshot({
      ...args,
      residenceChoices: { [residentId.toString()]: { countryId: "PL", stateId: "MAZ" } },
    });
    expect(changedChoice.payloadHash).not.toBe(staged.payloadHash);
  });

  it("verifies the staged source and rejects a changed treasury before application", async () => {
    const { args } = scenario();
    const intent = await stageLiveFederationSettlementIntent(args);
    const verify = () =>
      verifyLiveFederationSettlementIntent({
        db: args.db,
        intentId: intent._id,
        sourceCountryId: "RU",
        appliedOnTurn: 97,
      });
    await expect(verify()).resolves.toEqual(intent);
    await expect(
      verifyLiveFederationSettlementIntent({
        db: args.db,
        intentId: intent._id,
        sourceCountryId: "RU",
        appliedOnTurn: 98,
      })
    ).rejects.toThrow("another turn");
    await args.db
      .collection<{ _id: string; treasuryBalance: number }>("federalBudget")
      .updateOne({ _id: "RU" }, { $set: { treasuryBalance: 2 } });
    await expect(verify()).rejects.toThrow("live federation balance sheet");
  });

  it("rejects changed player choices and terms under the same application key", async () => {
    const { args } = scenario();
    await stageLiveFederationSettlementIntent(args);
    await expect(
      stageLiveFederationSettlementIntent({
        ...args,
        residenceChoices: { [residentId.toString()]: { countryId: "PL", stateId: "MAZ" } },
      })
    ).rejects.toThrow("conflicts");
    const changed = activation();
    changed.finances = planSuccessionFinances({
      settlementId: "ussr-1",
      sourceEntityId: "RU",
      participants: changed.territories.map(({ entityId, population }) => ({
        entityId,
        population,
      })),
      financialAssetsMinor: 100,
      creditorDebtMinor: 200,
      debtSharesBps: { RU: 5000, UKR: 5000 },
    });
    await expect(
      stageLiveFederationSettlementIntent({ ...args, activation: changed })
    ).rejects.toThrow("conflicts");
  });

  it("rejects a changed live treasury before writing an intent", async () => {
    const { args } = scenario();
    await args.db
      .collection<{ _id: string; treasuryBalance: number }>("federalBudget")
      .updateOne({ _id: "RU" }, { $set: { treasuryBalance: 2 } });
    await expect(stageLiveFederationSettlementIntent(args)).rejects.toThrow("finance terms");
    expect(await args.db.collection("federationSettlementIntents").find({}).toArray()).toHaveLength(
      0
    );
    expect(await args.db.collection("federationFacilityClaims").find({}).toArray()).toHaveLength(0);
  });

  it("refuses to stage a second settlement for an already partitioned federation", async () => {
    const { mem, args } = scenario();
    mem.seed("federationSettlementApplications", [
      {
        _id: "1991-default:older:1",
        presetId: "1991-default",
        settlementId: "older",
        revision: 1,
        sourceEntityId: "RU",
        status: "applied",
        entityIds: ["RU", "UKR"],
        appliedOnTurn: 96,
      },
    ]);
    await expect(stageLiveFederationSettlementIntent(args)).rejects.toThrow(
      "already has an applied"
    );
    expect(await args.db.collection("federationSettlementIntents").find({}).toArray()).toHaveLength(
      0
    );
  });
});
