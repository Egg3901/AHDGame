import { MongoClient, ObjectId, type CommandStartedEvent } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { openDefaultFederationPoliticalProposal } from "@/lib/world/succession/defaultProposal";
import { recordFederationRatifications } from "@/lib/world/succession/recordRatifications";
import { processLegacyFederationServiceTurn } from "@/lib/world/succession/legacyServiceTurn";
import { processRatifiedFederationSettlements } from "./federationSettlements";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";

const uri = process.env.FEDERATION_TEST_MONGO_URI;
type Fixture = { _id: string | ObjectId; [key: string]: unknown };

describe.skipIf(!uri)("federation settlement on an isolated Mongo replica set", () => {
  let client: MongoClient;
  let databaseName: string;
  let commands = 0;
  const residentId = new ObjectId("000000000000000000000301");
  const bondId = new ObjectId("000000000000000000000302");

  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Federation qualification accepts an explicit loopback test database only");
    client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5_000, monitorCommands: true });
    client.on("commandStarted", () => {
      commands += 1;
    });
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary)
      throw new Error("Federation qualification needs a writable replica-set primary");
  });

  beforeEach(async () => {
    databaseName = `ahd_test_federation_${new ObjectId().toHexString()}`;
    const db = client.db(databaseName);
    await db
      .collection<Fixture>("gameState")
      .insertOne({ _id: "current", preset: "1991-default", currentYear: 1992, currentTurn: 180 });
    await db.collection<Fixture>("countryGameStates").insertMany([
      { _id: "CS", dissolvedTurn: null, enabledForPlayers: true, status: "active" },
      { _id: "PL", enabledForPlayers: true, status: "active" },
    ]);
    await db
      .collection<Fixture>("states")
      .insertMany([
        ...csRegions1991.map((state) => ({ ...state })),
        { _id: "MAZ", countryId: "PL", population: 10, gdp: 100 },
      ]);
    await db.collection<Fixture>("federalBudget").insertOne({
      _id: "CS",
      countryId: "CS",
      currencyCode: "CSK",
      treasuryBalance: 40,
      debt: { principal: 3000 },
    });
    await db
      .collection<Fixture>("exchangeRates")
      .insertOne({ _id: "CSK", currencyCode: "CSK", rate: 2 });
    await db
      .collection<Fixture>("characters")
      .insertOne({ _id: residentId, countryId: "CS", homeState: "CS_SVK", cash: 50 });
    await db.collection<Fixture>("bonds").insertOne({
      _id: bondId,
      issuerType: "sovereign",
      countryId: "CS",
      currencyCode: "CSK",
      couponRate: 4.8,
      maturityTurn: 300,
      holders: [{ units: 2 }],
      publicFloat: 1,
      totalIssued: 3000,
      matured: false,
      defaulted: false,
    });
    const proposal = await openDefaultFederationPoliticalProposal({
      db,
      sourceCountryId: "CS",
      currentYear: 1992,
      now: new Date(0),
    });
    await db
      .collection("bills")
      .updateOne({ _id: proposal.billId }, { $set: { status: "signed", enactedAt: new Date(1) } });
    await recordFederationRatifications({
      db,
      sourceCountryId: "CS",
      settlementId: proposal.settlementId,
      revision: proposal.revision,
      currentTurn: 181,
    });
  });

  afterEach(async () => {
    if (databaseName?.startsWith("ahd_test_federation_"))
      await client.db(databaseName).dropDatabase();
  });
  afterAll(async () => {
    await client?.close();
  });

  it("commits real sovereignty and balances once, then services unchanged creditor contracts", async () => {
    const db = client.db(databaseName);
    commands = 0;
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2))
    ).toBe(1);
    const applicationCommands = commands;
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 182, 1992, new Date(3))
    ).toBe(0);
    expect(await db.collection("characters").findOne({ _id: residentId })).toMatchObject({
      cash: 50,
      federationPendingResidenceId: "1991-default:cs-1991-default:1",
    });
    expect(await db.collection("states").countDocuments({ countryId: "CS" })).toBe(0);
    expect(await db.collection("macroCountries").countDocuments({})).toBe(2);
    const accounts = await db
      .collection("federationFiscalAccounts")
      .find({ kind: "background-successor" })
      .toArray();
    expect(accounts.reduce((sum, account) => sum + account.openingCashMinor, 0)).toBe(2000);
    expect(accounts.reduce((sum, account) => sum + account.remainingContributionMinor, 0)).toBe(
      150000
    );
    commands = 0;
    expect(await processLegacyFederationServiceTurn(db, 182, new Date(3))).toBe(1);
    const serviceCommands = commands;
    const receipt = await db.collection("federationLegacyServiceTurns").findOne({ turn: 182 });
    expect(receipt).toMatchObject({ creditorDueMinor: 150 });
    await processLegacyFederationServiceTurn(db, 182, new Date(3));
    expect(await db.collection("federationLegacyServiceTurns").countDocuments({})).toBe(1);
    expect(await db.collection("bonds").findOne({ _id: bondId })).toMatchObject({
      countryId: "CS",
      currencyCode: "CSK",
      totalIssued: 3000,
      maturityTurn: 300,
      matured: false,
    });
    console.info(
      `Federation replica-set qualification: activation=${applicationCommands} commands; service=${serviceCommands} commands`
    );
  });

  it("bridges an unfunded creditor call, records arrears and recovers without default", async () => {
    const db = client.db(databaseName);
    await processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2));
    await db
      .collection("macroCountries")
      .updateMany({}, { $set: { federationTreasuryMinor: -1000, fiscalCapacity: 0 } });
    await processLegacyFederationServiceTurn(db, 182, new Date(3));
    const shortfall = await db.collection("federationLegacyServiceTurns").findOne({ turn: 182 });
    expect(shortfall).toMatchObject({
      creditorDueMinor: 150,
      bridgeOutstandingMinor: 150,
      administrationCashAfterMinor: -150,
    });
    expect(
      Object.values(shortfall!.successorArrearsMinor).reduce<number>(
        (sum, value) => sum + Number(value),
        0
      )
    ).toBe(150);
    expect(await db.collection<Fixture>("federalBudget").findOne({ _id: "CS" })).toMatchObject({
      treasuryBalance: -3,
    });
    expect(await db.collection("bonds").findOne({ _id: bondId })).toMatchObject({
      defaulted: false,
    });
    await db
      .collection("macroCountries")
      .updateMany({}, { $set: { federationTreasuryMinor: 1000, fiscalCapacity: 0.5 } });
    await processLegacyFederationServiceTurn(db, 183, new Date(4));
    expect(
      await db.collection("federationLegacyServiceTurns").findOne({ turn: 183 })
    ).toMatchObject({ bridgeOutstandingMinor: 0, administrationCashAfterMinor: 0 });
    expect(await db.collection("bonds").findOne({ _id: bondId })).toMatchObject({
      defaulted: false,
      currencyCode: "CSK",
    });
  });

  it("keeps activation below 140 commands with one hundred protected residents", async () => {
    const db = client.db(databaseName);
    await db.collection("characters").insertMany(
      Array.from({ length: 99 }, () => ({
        _id: new ObjectId(),
        countryId: "CS",
        homeState: "CS_SVK",
        cash: 50,
        currentOffice: null,
      }))
    );
    commands = 0;
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2))
    ).toBe(1);
    const activationCommands = commands;
    expect(activationCommands).toBeLessThanOrEqual(140);
    expect(
      await db.collection("characters").countDocuments({
        cash: 50,
        federationPendingResidenceId: "1991-default:cs-1991-default:1",
      })
    ).toBe(100);
    expect(await db.collection("federationResidentHolds").countDocuments({})).toBe(100);
    expect(
      await db
        .collection("federationRelocations")
        .countDocuments({ kind: "resident", status: "pending-choice" })
    ).toBe(100);
    console.info(
      `Federation replica-set qualification: 100-resident activation=${activationCommands} commands`
    );
  });

  it("continues an ordinary cursor under the transaction deadline without illegal maxTimeMS", async () => {
    const db = client.db(databaseName);
    await db
      .collection("characters")
      .insertOne({ _id: new ObjectId(), countryId: "CS", homeState: "CS_SVK" });
    const observed: Array<{ name: string; maxTimeMS: unknown }> = [];
    const observe = (event: CommandStartedEvent) => {
      if (event.commandName === "find" || event.commandName === "getMore")
        observed.push({ name: event.commandName, maxTimeMS: event.command.maxTimeMS });
    };
    client.on("commandStarted", observe);
    try {
      await runRequiredTransaction(
        async (session) => {
          const rows = await db
            .collection("characters")
            .find({}, { session, batchSize: 1 })
            .toArray();
          expect(rows).toHaveLength(2);
        },
        { client }
      );
    } finally {
      client.off("commandStarted", observe);
    }
    expect(observed.find((event) => event.name === "find")?.maxTimeMS).toBeGreaterThan(0);
    const continuations = observed.filter((event) => event.name === "getMore");
    expect(continuations.length).toBeGreaterThan(0);
    expect(continuations.every((event) => event.maxTimeMS == null)).toBe(true);
  });

  it("keeps an individual successor's arrears with that successor on recovery", async () => {
    const db = client.db(databaseName);
    await processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2));
    await db
      .collection<Fixture>("macroCountries")
      .updateOne({ _id: "SK" }, { $set: { federationTreasuryMinor: -1000, fiscalCapacity: 0 } });
    await processLegacyFederationServiceTurn(db, 182, new Date(3));
    const shortfall = await db.collection("federationLegacyServiceTurns").findOne({ turn: 182 });
    expect(shortfall?.successorArrearsMinor.CZ2).toBe(0);
    expect(shortfall?.successorArrearsMinor.SK).toBeGreaterThan(0);
    await db
      .collection<Fixture>("macroCountries")
      .updateOne({ _id: "SK" }, { $set: { federationTreasuryMinor: 1000, fiscalCapacity: 0.5 } });
    await processLegacyFederationServiceTurn(db, 183, new Date(4));
    const recovery = await db.collection("federationLegacyServiceTurns").findOne({ turn: 183 });
    expect(recovery?.successorContributionsMinor.CZ2).toBe(
      shortfall?.successorContributionsMinor.CZ2
    );
    expect(recovery?.successorContributionsMinor.SK).toBe(2 * shortfall!.successorArrearsMinor.SK);
    expect(recovery?.bridgeOutstandingMinor).toBe(0);
  });

  it("rolls back a late receipt failure and can apply on a later turn", async () => {
    const db = client.db(databaseName);
    await db.createCollection("federationSettlementApplications", {
      validator: { blocked: { $eq: true } },
    });
    await expect(
      processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2))
    ).rejects.toThrow(/validation/i);
    expect(await db.collection("states").countDocuments({ countryId: "CS" })).toBe(
      csRegions1991.length
    );
    for (const collection of [
      "federationSettlementIntents",
      "federationPublicationPreparations",
      "federationPreparedEffects",
      "federationFiscalAccounts",
      "macroCountries",
      "federationResidentHolds",
    ])
      expect(await db.collection(collection).countDocuments({})).toBe(0);
    await db.command({ collMod: "federationSettlementApplications", validator: {} });
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 182, 1992, new Date(3))
    ).toBe(1);
    expect(
      await db.collection("federationSettlementApplications").findOne({ sourceEntityId: "CS" })
    ).toMatchObject({ appliedOnTurn: 182 });
  });
});
