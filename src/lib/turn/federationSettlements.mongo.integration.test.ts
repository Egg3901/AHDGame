import { MongoClient, ObjectId, type CommandStartedEvent } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sovietUnionRegions1991 } from "@/lib/countries/ru/data/sovietUnionRegions1991";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { openDefaultFederationPoliticalProposal } from "@/lib/world/succession/defaultProposal";
import { recordFederationRatifications } from "@/lib/world/succession/recordRatifications";
import { processLegacyFederationServiceTurn } from "@/lib/world/succession/legacyServiceTurn";
import { materializeContinuingFederationServiceTurn } from "@/lib/world/succession/continuingServiceTurn";
import { processRatifiedFederationSettlements } from "./federationSettlements";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  materializeFacilityPaymentTurn,
  processFederationFacilityPaymentTurn,
} from "@/lib/world/succession/facilityPaymentTurn";

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

  it("pays one hundred firms through the normal compensation phase in at most twenty commands", async () => {
    const db = client.db(databaseName);
    const applicationId = "1991-default:payment-volume:1";
    await db.collection<Fixture>("federationSettlementApplications").insertOne({
      _id: applicationId,
      presetId: "1991-default",
      settlementId: "payment-volume",
      revision: 1,
      sourceEntityId: "RU",
      entityIds: ["RU", "UKR"],
      status: "applied",
      appliedOnTurn: 180,
    });
    await db.collection<Fixture>("worldEntityStates").insertMany(
      ["RU", "UKR"].map((entityId) => ({
        _id: `1991-default:${entityId}`,
        entityId,
        applicationId,
        appliedOnTurn: 180,
      }))
    );
    const firms = Array.from({ length: 100 }, () => ({
      _id: new ObjectId(),
      countryId: "RU",
      liquidCurrencyCode: "RUB",
      liquidCapital: 100,
    }));
    const claims = firms.map((firm, index) => ({
      _id: `${applicationId}:plant-${index}`,
      applicationId,
      claimId: `plant-${index}`,
      corporationId: firm._id.toHexString(),
      sectorId: `sector-${index}`,
      debtorEntityId: "UKR",
      creditorCountryId: "RU",
      amountAnchor: 10,
      status: "payable",
    }));
    await db.collection("corporations").insertMany(firms);
    await db.collection<Fixture>("federationFacilityClaims").insertMany(claims);
    await db.collection<Fixture>("federationFiscalAccounts").insertOne({
      _id: `${applicationId}:UKR`,
      applicationId,
      entityId: "UKR",
      kind: "background-successor",
      claimIds: claims.map((claim) => claim.claimId),
      facilityClaimLiabilityMinor: 100000,
    });
    await db.collection<Fixture>("macroCountries").insertOne({
      _id: "UKR",
      presetId: "1991-default",
      simulationTier: "background-macro",
      federationTreasuryMinor: 50000,
    });
    await db
      .collection<Fixture>("exchangeRates")
      .insertOne({ _id: "RUB", currencyCode: "RUB", rate: 2 });
    commands = 0;
    expect(await processFederationFacilityPaymentTurn(db, 181, new Date(2))).toBe(1);
    const paymentCommands = commands;
    expect(paymentCommands).toBeLessThanOrEqual(20);
    expect(await db.collection("corporations").countDocuments({ liquidCapital: 110 })).toBe(100);
    expect(
      await db
        .collection("federationFacilityClaims")
        .countDocuments({ paidMinor: 500, status: "payable" })
    ).toBe(100);
    expect(await db.collection<Fixture>("macroCountries").findOne({ _id: "UKR" })).toMatchObject({
      federationTreasuryMinor: 0,
    });
    expect(
      await db.collection("federationFacilityPaymentTurns").findOne({ applicationId })
    ).toMatchObject({ paidMinor: 50000 });
    await processFederationFacilityPaymentTurn(db, 181, new Date(3));
    expect(await db.collection("corporations").countDocuments({ liquidCapital: 110 })).toBe(100);
    console.info(
      `Facility volume qualification: payment=${paymentCommands} commands; firms=100; transferred=50000 minor`
    );
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

  it("keeps activation below 150 commands with one hundred protected residents", async () => {
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
    // Measured 146 commands after fixed-cost retirement of dissolved institutions.
    expect(activationCommands).toBeLessThanOrEqual(150);
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

  it("retires dissolved institutions atomically, preserves history and retries without ghosts", async () => {
    const db = client.db(databaseName);
    const deputyId = new ObjectId();
    const foreignId = new ObjectId();
    const electionId = new ObjectId();
    await db.collection<Fixture>("npps").insertMany([
      {
        _id: deputyId,
        countryId: "CS",
        currentOffice: { type: "federalAssemblyDeputy" },
        liquidCapital: 50,
      },
      { _id: foreignId, countryId: "PL", currentOffice: { type: "sejmDeputy" } },
    ]);
    await db
      .collection("characters")
      .updateOne(
        { _id: residentId },
        { $set: { currentOffice: { type: "parliamentaryCabinet" } } }
      );
    await db.collection<Fixture>("electedOfficials").insertOne({
      _id: new ObjectId(),
      countryId: "CS",
      officeType: "federalAssemblyDeputy",
      nppId: deputyId,
    });
    await db.collection<Fixture>("cabinetMembers").insertMany([
      { _id: new ObjectId(), countryId: "CS", nppId: deputyId },
      { _id: new ObjectId(), countryId: "PL", nppId: foreignId },
    ]);
    await db.collection<Fixture>("governmentFormations").insertOne({
      _id: "CS",
      countryId: "CS",
      status: "formed",
      pmNppId: deputyId,
      pmName: "Prime Minister",
      hosNppId: deputyId,
      hosName: "Head of State",
      coalitionPartyIds: ["1"],
      activeVoteId: new ObjectId(),
      governingAgenda: { agenda: "old" },
    });
    await db
      .collection<Fixture>("elections")
      .insertOne({ _id: electionId, countryId: "CS", status: "upcoming" });
    await db.collection<Fixture>("electionCandidates").insertOne({
      _id: new ObjectId(),
      electionId,
      countryId: "CS",
      nppId: deputyId,
      status: "active",
    });
    for (const collectionName of ["pmAppointmentVotes", "noConfidenceVotes"])
      await db.collection<Fixture>(collectionName).insertMany([
        { _id: new ObjectId(), countryId: "CS", status: "active" },
        { _id: new ObjectId(), countryId: "PL", status: "active" },
        { _id: new ObjectId(), countryId: "CS", status: "passed" },
      ]);
    await db.createCollection("federationSettlementApplications", {
      validator: { blocked: { $eq: true } },
    });
    await expect(
      processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2))
    ).rejects.toThrow(/validation/i);
    expect(await db.collection("federationArchivedPoliticalRows").countDocuments({})).toBe(0);
    expect(await db.collection("cabinetMembers").countDocuments({ countryId: "CS" })).toBe(1);
    expect(await db.collection("npps").findOne({ _id: deputyId })).toMatchObject({
      currentOffice: { type: "federalAssemblyDeputy" },
    });
    expect(
      await db.collection("electionCandidates").countDocuments({ electionId, status: "active" })
    ).toBe(1);
    expect(
      await db.collection<Fixture>("governmentFormations").findOne({ _id: "CS" })
    ).toMatchObject({ status: "formed", hosName: "Head of State" });
    await db.command({ collMod: "federationSettlementApplications", validator: {} });
    commands = 0;
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 182, 1992, new Date(3))
    ).toBe(1);
    const activationCommands = commands;
    expect(activationCommands).toBeLessThanOrEqual(180);
    expect(await db.collection("npps").findOne({ _id: deputyId })).toMatchObject({
      currentOffice: null,
      liquidCapital: 50,
    });
    expect(await db.collection("npps").findOne({ _id: foreignId })).toMatchObject({
      currentOffice: { type: "sejmDeputy" },
    });
    expect(await db.collection("characters").findOne({ _id: residentId })).toMatchObject({
      currentOffice: null,
      cash: 50,
      federationPendingResidenceId: "1991-default:cs-1991-default:1",
    });
    expect(await db.collection("cabinetMembers").countDocuments({ countryId: "CS" })).toBe(0);
    expect(await db.collection("cabinetMembers").countDocuments({ countryId: "PL" })).toBe(1);
    expect(
      await db.collection("electionCandidates").countDocuments({ electionId, status: "withdrawn" })
    ).toBe(1);
    for (const collectionName of ["pmAppointmentVotes", "noConfidenceVotes"]) {
      expect(
        await db.collection(collectionName).countDocuments({ countryId: "CS", status: "active" })
      ).toBe(0);
      expect(
        await db.collection(collectionName).countDocuments({ countryId: "PL", status: "active" })
      ).toBe(1);
      expect(
        await db.collection(collectionName).countDocuments({ countryId: "CS", status: "passed" })
      ).toBe(1);
    }
    expect(
      await db.collection<Fixture>("governmentFormations").findOne({ _id: "CS" })
    ).toMatchObject({
      status: "collapsed",
      pmNppId: null,
      hosNppId: null,
      coalitionPartyIds: null,
      activeVoteId: null,
      totalSeats: 0,
      governingAgenda: null,
    });
    expect(await db.collection("federationArchivedPoliticalRows").countDocuments({})).toBe(3);
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 183, 1992, new Date(4))
    ).toBe(0);
    expect(await db.collection("federationArchivedPoliticalRows").countDocuments({})).toBe(3);
    console.info(
      `Federation institution qualification: activation=${activationCommands} commands; rollback, history and retry passed`
    );
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
  it("rolls back the complete Soviet handoff, retries with retained mandates and never duplicates them", async () => {
    const db = client.db(databaseName);
    // Remove the independent Czech proposal so this fixture exercises one full Soviet activation.
    await db.collection("federationPoliticalProposals").deleteMany({});
    await db.collection("federationRatifications").deleteMany({});
    await db
      .collection<Fixture>("countryGameStates")
      .insertOne({ _id: "RU", enabledForPlayers: true, status: "active" });
    await db
      .collection<Fixture>("countryState")
      .insertOne({ _id: "RU", countryId: "RU", governmentType: "onePartyState", rulingPartyId: 1 });
    await db
      .collection<Fixture>("states")
      .insertMany(sovietUnionRegions1991.map((row) => ({ ...row })));
    await db.collection<Fixture>("federalBudget").insertOne({
      _id: "RU",
      countryId: "RU",
      currencyCode: "RUB",
      treasuryBalance: 100,
      debt: { principal: 1000 },
    });
    await db
      .collection<Fixture>("exchangeRates")
      .insertOne({ _id: "RUB", currencyCode: "RUB", rate: 1 });
    const sovietBondId = new ObjectId();
    await db.collection("bonds").insertOne({
      _id: sovietBondId,
      issuerType: "sovereign",
      countryId: "RU",
      currencyCode: "RUB",
      totalIssued: 1000,
      couponRate: 4.8,
      maturityTurn: 300,
      holders: [{ units: 1 }],
      publicFloat: 0,
      matured: false,
      defaulted: false,
    });
    const retained = sovietUnionRegions1991.find((row) => !row._id.startsWith("SU_"))!;
    const retainedFirmId = new ObjectId();
    await db.collection("corporations").insertOne({
      _id: retainedFirmId,
      countryId: "RU",
      headquartersState: retained._id,
      liquidCurrencyCode: "RUB",
      liquidCapital: 200,
      suspended: false,
    });
    await db.collection("corporateSectors").insertOne({
      _id: new ObjectId(),
      corporationId: retainedFirmId,
      countryId: "RU",
      stateId: "SU_UKR",
      sectorType: "manufacturing",
      capacityBookAnchor: 1000,
      capitalStock: 10,
    });
    const playerId = new ObjectId();
    const slateId = new ObjectId();
    await db.collection("characters").insertOne({
      _id: playerId,
      countryId: "RU",
      homeState: retained._id,
      cash: 75,
      currentOffice: { type: "unionCongressDeputy" },
    });
    await db.collection("npps").insertOne({
      _id: slateId,
      countryId: "RU",
      funds: 125,
      homeState: retained._id,
      currentOffice: { type: "unionCongressDeputy" },
    });
    await db.collection("electedOfficials").insertMany([
      {
        _id: new ObjectId(),
        countryId: "RU",
        officeType: "unionCongressDeputy",
        state: retained._id,
        characterId: playerId,
        party: "2",
        seatsHeld: 1,
      },
      {
        _id: new ObjectId(),
        countryId: "RU",
        officeType: "unionCongressDeputy",
        state: retained._id,
        nppId: slateId,
        party: "1",
        seatsHeld: 3,
      },
    ]);
    const proposal = await openDefaultFederationPoliticalProposal({
      db,
      sourceCountryId: "RU",
      currentYear: 1992,
      now: new Date(0),
    });
    await db
      .collection("bills")
      .updateOne({ _id: proposal.billId }, { $set: { status: "signed", enactedAt: new Date(1) } });
    const decisions = await recordFederationRatifications({
      db,
      sourceCountryId: "RU",
      settlementId: proposal.settlementId,
      revision: proposal.revision,
      currentTurn: 181,
    });
    expect(decisions).toHaveLength(15);
    expect(decisions.every((row) => row.choice === "approve")).toBe(true);
    await db.createCollection("federationSettlementApplications", {
      validator: { blocked: { $eq: true } },
    });
    await expect(
      processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2))
    ).rejects.toThrow(/validation/i);
    expect(await db.collection("states").countDocuments({ countryId: "RU" })).toBe(
      sovietUnionRegions1991.length
    );
    expect(
      await db
        .collection("electedOfficials")
        .countDocuments({ countryId: "RU", officeType: "unionCongressDeputy" })
    ).toBe(2);
    expect(await db.collection("characters").findOne({ _id: playerId })).toMatchObject({
      cash: 75,
      currentOffice: { type: "unionCongressDeputy" },
    });
    expect(
      await db.collection<Fixture>("countryGameStates").findOne({ _id: "RU" })
    ).not.toHaveProperty("ruSovietSuccessionSinceTurn");
    for (const name of [
      "federationArchivedPoliticalRows",
      "governmentFormations",
      "federationFiscalAccounts",
      "worldEntityStates",
      "macroCountries",
    ]) {
      expect(await db.collection(name).countDocuments({})).toBe(0);
    }
    await db.command({ collMod: "federationSettlementApplications", validator: {} });
    commands = 0;
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 182, 1992, new Date(3))
    ).toBe(1);
    const activationCommands = commands;
    const capacity = sovietUnionRegions1991
      .filter((row) => !row._id.startsWith("SU_"))
      .reduce((sum, row) => sum + row.houseDistricts, 0);
    expect(await db.collection<Fixture>("countryGameStates").findOne({ _id: "RU" })).toMatchObject({
      ruSovietSuccessionSinceTurn: 182,
      ruProvisionalCongressSeats: capacity,
    });
    expect(
      await db.collection<Fixture>("governmentFormations").findOne({ _id: "RU" })
    ).toMatchObject({
      status: "pending",
      totalSeats: capacity,
      majorityThreshold: Math.floor(capacity / 2) + 1,
      seatsByParty: { "1": 3, "2": 1 },
    });
    expect(await db.collection("characters").findOne({ _id: playerId })).toMatchObject({
      cash: 75,
      currentOffice: { type: "congressDeputy" },
    });
    expect(await db.collection("npps").findOne({ _id: slateId })).toMatchObject({
      funds: 125,
      currentOffice: { type: "congressDeputy", seatsHeld: 3 },
    });
    expect(await db.collection("macroCountries").countDocuments({})).toBe(14);
    expect(await db.collection("corporations").findOne({ _id: retainedFirmId })).toMatchObject({
      headquartersState: retained._id,
      liquidCurrencyCode: "RUB",
      liquidCapital: 200,
      suspended: false,
    });
    expect(
      await db
        .collection("federationPrivateFirmHolds")
        .countDocuments({ corporationId: retainedFirmId.toHexString() })
    ).toBe(0);
    expect(
      await db
        .collection("federationFacilityClaims")
        .findOne({ corporationId: retainedFirmId.toHexString() })
    ).toMatchObject({ status: "payable", creditorCountryId: "RU", debtorEntityId: "UKR" });
    const continuingApplication = await db
      .collection<Fixture>("federationSettlementApplications")
      .findOne({});
    expect(continuingApplication).not.toBeNull();
    const oldContract = await db.collection("bonds").findOne({ _id: sovietBondId });
    expect(oldContract).not.toBeNull();
    // Borrowing after the split must not enter the approved inherited inventory.
    await db.collection("bonds").insertOne({
      ...oldContract!,
      _id: new ObjectId(),
      totalIssued: 2000,
      holders: [{ units: 2 }],
    });
    const sourceBefore = await db.collection<Fixture>("federalBudget").findOne({ _id: "RU" });
    const macrosBefore = await db
      .collection<Fixture>("macroCountries")
      .find({})
      .sort({ _id: 1 })
      .toArray();
    const accountsBefore = await db
      .collection<Fixture>("federationFiscalAccounts")
      .find({})
      .sort({ _id: 1 })
      .toArray();
    await db.createCollection("federationContinuingServiceTurns", {
      validator: { blocked: { $eq: true } },
    });
    const continuingService = () =>
      runRequiredTransaction(
        (session) =>
          materializeContinuingFederationServiceTurn({
            db,
            session,
            applicationId: String(continuingApplication!._id),
            turn: 183,
            now: new Date(4),
          }),
        { client }
      );
    await expect(continuingService()).rejects.toThrow(/validation/i);
    expect(await db.collection<Fixture>("federalBudget").findOne({ _id: "RU" })).toEqual(
      sourceBefore
    );
    expect(
      await db.collection<Fixture>("macroCountries").find({}).sort({ _id: 1 }).toArray()
    ).toEqual(macrosBefore);
    expect(
      await db.collection<Fixture>("federationFiscalAccounts").find({}).sort({ _id: 1 }).toArray()
    ).toEqual(accountsBefore);
    await db.command({ collMod: "federationContinuingServiceTurns", validator: {} });
    commands = 0;
    const serviceReceipt = await continuingService();
    const serviceCommands = commands;
    expect(serviceCommands).toBeLessThanOrEqual(20);
    expect(serviceReceipt.creditorDueMinor).toBeGreaterThan(0);
    const contributions = Object.values(serviceReceipt.successorContributionsMinor).reduce(
      (sum, value) => sum + value,
      0
    );
    expect(
      contributions +
        serviceReceipt.issuerOwnShareMinor +
        Object.values(serviceReceipt.successorArrearsMinor).reduce((sum, value) => sum + value, 0)
    ).toBe(serviceReceipt.creditorDueMinor);
    const sourceAfter = await db.collection<Fixture>("federalBudget").findOne({ _id: "RU" });
    const liveRate = await db.collection<Fixture>("exchangeRates").findOne({ _id: "RUB" });
    expect(
      Number(sourceAfter!.treasuryBalance) - Number(sourceBefore!.treasuryBalance)
    ).toBeCloseTo((contributions / 100) * Number(liveRate!.rate));
    expect(await db.collection("bonds").findOne({ _id: sovietBondId })).toEqual(oldContract);
    expect(await db.collection("federationLegacyServiceTurns").countDocuments()).toBe(0);
    expect(await continuingService()).toEqual(serviceReceipt);
    expect(await db.collection<Fixture>("federalBudget").findOne({ _id: "RU" })).toEqual(
      sourceAfter
    );
    console.info(
      `Continuing issuer qualification: service=${serviceCommands} commands; contributions=${contributions} minor; late rollback and replay passed`
    );
    await db
      .collection<Fixture>("macroCountries")
      .updateOne({ _id: "UKR" }, { $set: { federationTreasuryMinor: 500 } });
    await db.createCollection("federationFacilityPaymentTurns", {
      validator: { blocked: { $eq: true } },
    });
    // The application key is shared with the already qualified settlement receipt.
    const applied = await db.collection<Fixture>("federationSettlementApplications").findOne({});
    expect(applied).not.toBeNull();
    const payment = () =>
      runRequiredTransaction(
        (session) =>
          materializeFacilityPaymentTurn({
            db,
            session,
            applicationId: String(applied!._id),
            turn: 183,
            now: new Date(4),
          }),
        { client }
      );
    await expect(payment()).rejects.toThrow(/validation/i);
    expect(await db.collection("corporations").findOne({ _id: retainedFirmId })).toMatchObject({
      liquidCapital: 200,
    });
    expect(await db.collection<Fixture>("macroCountries").findOne({ _id: "UKR" })).toMatchObject({
      federationTreasuryMinor: 500,
    });
    expect(
      await db
        .collection("federationFacilityClaims")
        .findOne({ corporationId: retainedFirmId.toHexString() })
    ).not.toHaveProperty("paidMinor");
    await db.command({ collMod: "federationFacilityPaymentTurns", validator: {} });
    commands = 0;
    expect(await payment()).toMatchObject({ paidMinor: 500 });
    const paymentCommands = commands;
    expect(paymentCommands).toBeLessThanOrEqual(20);
    expect(await db.collection("corporations").findOne({ _id: retainedFirmId })).toMatchObject({
      liquidCapital: 205,
    });
    expect(await db.collection<Fixture>("macroCountries").findOne({ _id: "UKR" })).toMatchObject({
      federationTreasuryMinor: 0,
    });
    expect(
      await db
        .collection("federationFacilityClaims")
        .findOne({ corporationId: retainedFirmId.toHexString() })
    ).toMatchObject({ paidMinor: 500, status: "payable" });
    expect(await payment()).toMatchObject({ paidMinor: 500 });
    expect(await db.collection("corporations").findOne({ _id: retainedFirmId })).toMatchObject({
      liquidCapital: 205,
    });
    console.info(
      `Facility compensation qualification: payment=${paymentCommands} commands; cash=500 minor; late rollback and replay passed`
    );
    expect(await db.collection("bonds").findOne({ _id: sovietBondId })).toMatchObject({
      countryId: "RU",
      currencyCode: "RUB",
      totalIssued: 1000,
      matured: false,
      defaulted: false,
    });
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 183, 1992, new Date(4))
    ).toBe(0);
    expect(
      await db
        .collection("electedOfficials")
        .countDocuments({ countryId: "RU", officeType: "congressDeputy" })
    ).toBe(2);
    expect(await db.collection("federationArchivedPoliticalRows").countDocuments({})).toBe(2);
    console.info(
      `Soviet replica-set qualification: activation=${activationCommands} commands; retainedCapacity=${capacity}`
    );
  });
  it("keeps one hundred private firms and facility claims below 180 activation commands", async () => {
    const db = client.db(databaseName);
    const firms = Array.from({ length: 100 }, (_, index) => ({
      _id: new ObjectId(),
      countryId: "CS",
      headquartersState: "CS_SVK",
      liquidCapital: 100 + index,
      suspended: false,
    }));
    await db.collection("corporations").insertMany(firms);
    await db.collection("corporateSectors").insertMany(
      firms.map((firm) => ({
        _id: new ObjectId(),
        corporationId: firm._id,
        countryId: "CS",
        stateId: "CS_SVK",
        sectorType: "manufacturing",
        capacityBookAnchor: 1000,
        capitalStock: 10,
      }))
    );
    commands = 0;
    expect(
      await processRatifiedFederationSettlements(db, "1991-default", 181, 1992, new Date(2))
    ).toBe(1);
    const activationCommands = commands;
    expect(activationCommands).toBeLessThanOrEqual(180);
    expect(
      await db.collection("corporations").countDocuments({
        suspended: true,
        federationPendingHeadquartersId: "1991-default:cs-1991-default:1",
      })
    ).toBe(100);
    expect(await db.collection("federationPrivateFirmHolds").countDocuments({})).toBe(100);
    expect(
      await db.collection("federationFacilityClaims").countDocuments({ status: "contingent" })
    ).toBe(100);
    expect(await db.collection("corporateSectors").countDocuments({})).toBe(0);
    const saved = await db.collection("corporations").find({}).sort({ liquidCapital: 1 }).toArray();
    expect(saved.map((row) => row.liquidCapital)).toEqual(firms.map((row) => row.liquidCapital));
    console.info(
      `Federation firm-volume qualification: activation=${activationCommands} commands; firms=100; facilities=100`
    );
  });
});
