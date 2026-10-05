import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { processDepartmentProgramSettlement } from "../../src/lib/turn/departmentProgramSettlement";
import type { FederalBudget } from "../../src/lib/db/types/budget";

const FIXTURE_DB_PREFIX = "ahd_leg_mod_";

interface StringIdDocument extends Record<string, unknown> {
  _id: string;
}

export function assertSafeLegislativeMongoTarget(env: Partial<NodeJS.ProcessEnv>): string {
  const uri = env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is required for the isolated modernization run");
  if (env.MONGODB_URI_LIVE?.trim().replace(/\/+$/, "") === uri.replace(/\/+$/, "")) {
    throw new Error("MONGODB_URI matches MONGODB_URI_LIVE; refusing to run");
  }
  return uri;
}

export function legislativeFixtureDatabaseName(): string {
  return `${FIXTURE_DB_PREFIX}${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
}

export function assertLegislativeFixtureDatabaseName(name: string): void {
  if (!name.startsWith(FIXTURE_DB_PREFIX) || !/^ahd_leg_mod_[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error("refusing to operate outside the legislative fixture prefix");
  }
}

const fixtures = [
  {
    countryId: "US",
    budgetId: "federal",
    regionId: "US_FIXTURE",
    typeId: "us_fixture_health_program",
    optionId: "us_fixture_health_option",
    portfolioId: "health",
    capacityType: "health_service_delivery",
  },
  {
    countryId: "UK",
    budgetId: "UK",
    regionId: "UK_FIXTURE",
    typeId: "uk_fixture_education_program",
    optionId: "uk_fixture_education_option",
    portfolioId: "education_research",
    capacityType: "education_and_research_delivery",
  },
  {
    countryId: "JP",
    budgetId: "JP",
    regionId: "JP_FIXTURE",
    typeId: "jp_fixture_transport_program",
    optionId: "jp_fixture_transport_option",
    portfolioId: "transport_infrastructure",
    capacityType: "capital_delivery",
  },
] as const;

export async function seedLegislativeFixture(
  client: MongoClient,
  databaseName: string
): Promise<void> {
  assertLegislativeFixtureDatabaseName(databaseName);
  const db = client.db(databaseName);
  await db.collection<StringIdDocument>("gameState").insertOne({
    _id: "current",
    currentTurn: 10,
    currentYear: 2023,
    startingYear: 2023,
    eraSystemEnabled: false,
    departmentFinanceEnabled: true,
    lawAdministrationEnabled: true,
    regionalLegislationFinanceEnabled: true,
  });
  await db.collection<StringIdDocument>("gameConfig").insertOne({
    _id: "default",
    commandEconomyEnabled: false,
  });
  await db.collection<StringIdDocument>("states").insertMany(
    fixtures.map((fixture) => ({
      _id: fixture.regionId,
      countryId: fixture.countryId,
      name: `${fixture.countryId} Fixture Region`,
      population: 1_000_000,
      gdp: 50_000,
    }))
  );
  await db.collection<StringIdDocument>("federalBudget").insertMany(
    fixtures.map((fixture) => ({
      _id: fixture.budgetId,
      countryId: fixture.countryId,
      fiscalYear: 2023,
      gdp: 50_000_000_000,
      treasuryBalance: 987_654_321,
      revenue: { total: 10_000_000_000 },
      spending: { byCategory: {}, stateGrants: 0, debtInterest: 0, total: 4_800 },
      debt: { principal: 0, interestRate: 0, annualInterest: 0 },
      surplus: 0,
      updatedAt: new Date(0),
    }))
  );
  await db.collection<StringIdDocument>("legislationTypes").insertMany(
    fixtures.map((fixture) => ({
      _id: fixture.typeId,
      countryScope: fixture.countryId.toLowerCase(),
      name: `${fixture.countryId} Fixture Program`,
      description: "Isolated finance fixture",
      policyDomain: "fixture",
      subCategory: "fixture",
      allowedScope: "national",
      positions: [],
      administration: {
        primaryPortfolioId: fixture.portfolioId,
        lawKind:
          fixture.portfolioId === "transport_infrastructure"
            ? "capital_program"
            : "service_program",
        implementationMode: "direct",
        allowedJurisdictionModes: ["national_direct"],
        defaultJurisdictionMode: "national_direct",
        appropriationClass:
          fixture.portfolioId === "transport_infrastructure" ? "capital" : "operating",
        fundingSemantics: "appropriation_included",
        capacityDemand: { [fixture.capacityType]: 100 },
        policyFamilyId: fixture.typeId,
      },
      policyOptions: [
        {
          id: fixture.optionId,
          name: "Fixture option",
          stance: "center",
          effectDirection: 0,
          annualCostPerCapita: 0.0048,
          implementation: {
            programId: `${fixture.typeId}:program`,
            fundingSemantics: "appropriation_included",
            appropriationClass:
              fixture.portfolioId === "transport_infrastructure" ? "capital" : "operating",
            obligationPriority: 5,
            capacityType: fixture.capacityType,
            capacityDemand: { [fixture.capacityType]: 100 },
            rampProfileId:
              fixture.portfolioId === "transport_infrastructure" ? "capital_build" : "standard",
          },
        },
      ],
    }))
  );
  await db.collection("enactedLaws").insertMany(
    fixtures.map((fixture) => ({
      _id: new ObjectId(),
      billId: new ObjectId(),
      legislationTypeId: fixture.typeId,
      title: `${fixture.countryId} Fixture Program`,
      scope: "national",
      countryId: fixture.countryId,
      jurisdictionMode: "national_direct",
      budgetCost: 0,
      annualCostUsd: 4_800,
      policyOptionIndex: 0,
      budgetCategory: "fixture",
      enactedAt: new Date(0),
      enactedYear: 2023,
    }))
  );
}

export async function runLegislativeModernizationMongo(env: NodeJS.ProcessEnv = process.env) {
  const client = new MongoClient(assertSafeLegislativeMongoTarget(env), {
    serverSelectionTimeoutMS: 10_000,
    monitorCommands: true,
  });
  const databaseName = legislativeFixtureDatabaseName();
  assertLegislativeFixtureDatabaseName(databaseName);
  type WindowName = "first" | "replay";
  const telemetry: Record<
    WindowName,
    { roundTrips: number; responseBytes: number; documents: number }
  > = {
    first: { roundTrips: 0, responseBytes: 0, documents: 0 },
    replay: { roundTrips: 0, responseBytes: 0, documents: 0 },
  };
  let activeWindow: WindowName | null = null;
  const requestWindows = new Map<number, WindowName>();
  client.on("commandStarted", (event) => {
    if (!activeWindow || event.databaseName !== databaseName) return;
    telemetry[activeWindow].roundTrips += 1;
    requestWindows.set(event.requestId, activeWindow);
  });
  client.on("commandSucceeded", (event) => {
    const window = requestWindows.get(event.requestId);
    if (!window) return;
    requestWindows.delete(event.requestId);
    const reply = event.reply as {
      cursor?: { firstBatch?: unknown[]; nextBatch?: unknown[] };
    };
    telemetry[window].responseBytes += Buffer.byteLength(JSON.stringify(reply), "utf8");
    const cursor = reply.cursor;
    telemetry[window].documents += cursor?.firstBatch?.length ?? cursor?.nextBatch?.length ?? 0;
  });
  await client.connect();
  const defaultDatabase = client.db();
  const defaultCollectionsBefore = (
    await defaultDatabase.listCollections({}, { nameOnly: true }).toArray()
  )
    .map(({ name }) => name)
    .sort();
  try {
    await seedLegislativeFixture(client, databaseName);
    const db = client.db(databaseName);
    const before = await db
      .collection<FederalBudget>("federalBudget")
      .find({})
      .sort({ countryId: 1 })
      .toArray();
    activeWindow = "first";
    const first = await processDepartmentProgramSettlement(db, 10, {
      departmentFinanceEnabled: true,
    });
    activeWindow = null;
    const afterFirst = await db
      .collection<FederalBudget>("federalBudget")
      .find({})
      .sort({ countryId: 1 })
      .toArray();
    activeWindow = "replay";
    const replay = await processDepartmentProgramSettlement(db, 10, {
      departmentFinanceEnabled: true,
    });
    activeWindow = null;
    const afterReplay = await db
      .collection<FederalBudget>("federalBudget")
      .find({})
      .sort({ countryId: 1 })
      .toArray();
    const assertions = {
      everyCountrySettled:
        first.countriesProcessed === 3 &&
        first.departmentsSettled === 3 &&
        first.programsSettled === 3,
      replayAddedNoFlow:
        replay.programsSettled === 0 && replay.authorityAccrued === 0 && replay.outlaid === 0,
      replayStateIdentical: JSON.stringify(afterFirst) === JSON.stringify(afterReplay),
      treasuryUnchanged: before.every(
        (budget, index) => budget.treasuryBalance === afterFirst[index]?.treasuryBalance
      ),
      everyAccountNonNegative: afterFirst.every((budget) =>
        Object.values(budget.departmentAccounts ?? {}).every(
          (account) => account.balance >= 0 && account.encumbered >= 0
        )
      ),
    };
    if (!Object.values(assertions).every(Boolean)) {
      throw new Error(`isolated Mongo assertions failed: ${JSON.stringify(assertions)}`);
    }
    return {
      fixtureDatabasePrefix: FIXTURE_DB_PREFIX,
      first,
      replay,
      telemetry,
      assertions,
    };
  } finally {
    assertLegislativeFixtureDatabaseName(databaseName);
    await client.db(databaseName).dropDatabase();
    const defaultCollectionsAfter = (
      await defaultDatabase.listCollections({}, { nameOnly: true }).toArray()
    )
      .map(({ name }) => name)
      .sort();
    await client.close();
    if (JSON.stringify(defaultCollectionsBefore) !== JSON.stringify(defaultCollectionsAfter)) {
      throw new Error("the URI default database changed during the isolated run");
    }
  }
}

if (process.argv[1]?.endsWith("legislativeModernizationMongo2026-09-21.ts")) {
  runLegislativeModernizationMongo()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "isolated Mongo run failed");
      process.exitCode = 1;
    });
}
