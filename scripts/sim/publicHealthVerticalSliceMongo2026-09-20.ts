import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { processDepartmentProgramSettlement } from "../../src/lib/turn/departmentProgramSettlement";
import { loadPublicHealthDeliveryMultiplier } from "../../src/lib/governmentFinance/deliveryMultiplier";
import {
  US_HEALTH_DEPARTMENT_ID,
  US_PUBLIC_HEALTH_PROGRAM_ID,
} from "../../src/lib/governmentFinance/departments";

const FIXTURE_DB_PREFIX = "ahd_public_health_slice_";

export function normalizeMongoUri(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function assertSafeMongoTarget(env: Partial<NodeJS.ProcessEnv>): string {
  const uri = env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required for the isolated vertical-slice run");
  const live = env.MONGODB_URI_LIVE;
  if (live && normalizeMongoUri(uri) === normalizeMongoUri(live)) {
    throw new Error("MONGODB_URI matches MONGODB_URI_LIVE; refusing to run");
  }
  return uri;
}

export function uniqueFixtureDatabaseName(): string {
  // Atlas limits database names to 38 bytes. The fixed prefix is 24 bytes,
  // leaving room for a base-36 timestamp, separator, and four random hex digits.
  return `${FIXTURE_DB_PREFIX}${Date.now().toString(36)}_${randomUUID().slice(0, 4)}`;
}

export function assertFixtureDatabaseName(name: string): void {
  if (
    !name.startsWith(FIXTURE_DB_PREFIX) ||
    !/^ahd_public_health_slice_[a-zA-Z0-9_]+$/.test(name)
  ) {
    throw new Error("refusing to operate on a database outside the vertical-slice prefix");
  }
}

export async function seedFixture(client: MongoClient, databaseName: string): Promise<void> {
  assertFixtureDatabaseName(databaseName);
  const db = client.db(databaseName);
  const billId = new ObjectId();
  await Promise.all([
    db.collection<{ _id: string; [key: string]: unknown }>("gameState").insertOne({
      _id: "current",
      currentTurn: 10,
      currentYear: 2023,
      startingYear: 2023,
      eraSystemEnabled: false,
      departmentProgramSliceEnabled: true,
    }),
    db.collection<{ _id: string; [key: string]: unknown }>("gameConfig").insertOne({
      _id: "default",
      commandEconomyEnabled: false,
    }),
    db.collection<{ _id: string; [key: string]: unknown }>("states").insertOne({
      _id: "TEST_REGION",
      countryId: "US",
      name: "Fixture Region",
      population: 100_000_000,
      gdp: 25_000_000,
    }),
    db.collection<{ _id: string; [key: string]: unknown }>("federalBudget").insertOne({
      _id: "federal",
      countryId: "US",
      fiscalYear: 2023,
      gdp: 25_000_000_000_000,
      treasuryBalance: 123_456_789,
      revenue: { total: 5_000_000_000_000 },
      spending: {
        byCategory: { healthcare: 9_300_000_000 },
        stateGrants: 0,
        debtInterest: 0,
        total: 9_300_000_000,
      },
      debt: { principal: 0, interestRate: 0, annualInterest: 0 },
      surplus: 0,
      updatedAt: new Date(0),
    }),
    db.collection("enactedLaws").insertOne({
      _id: new ObjectId(),
      billId,
      legislationTypeId: "us_public_health",
      title: "Public Health Workforce Expansion Act",
      scope: "national",
      countryId: "US",
      budgetCost: 0,
      annualCostPerCapita: 93,
      policyOptionIndex: 1,
      budgetCategory: "healthcare",
      enactedAt: new Date(0),
      enactedYear: 2023,
    }),
    db.collection<{ _id: string; [key: string]: unknown }>("legislationTypes").insertOne({
      _id: "us_public_health",
      administration: {
        primaryPortfolioId: "health",
        primaryDepartmentId: "us_health_department",
        responsiblePositionId: "secretary_of_health",
        jurisdictionMode: "national_direct",
      },
      policyOptions: [
        { id: "public_health_opt_0", name: "Fixture Alternative" },
        {
          id: "public_health_opt_1",
          name: "Public Health Workforce Expansion Act",
          implementation: {
            programId: "us_public_health_workforce",
            fundingSemantics: "appropriation_included",
            appropriationClass: "operating",
            obligationPriority: 6,
            capacityType: "public_health_operations",
            outcome: { category: "healthcare", metricId: "publicHealthPreparedness" },
          },
        },
      ],
    }),
  ]);
}

export async function runMongoVerticalSlice(env: NodeJS.ProcessEnv = process.env) {
  const uri = assertSafeMongoTarget(env);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  const fixtureDatabaseName = uniqueFixtureDatabaseName();
  assertFixtureDatabaseName(fixtureDatabaseName);
  await client.connect();
  const defaultDatabase = client.db();
  const beforeDefaultCollections = (
    await defaultDatabase.listCollections({}, { nameOnly: true }).toArray()
  )
    .map(({ name }) => name)
    .sort();
  try {
    await seedFixture(client, fixtureDatabaseName);
    const db = client.db(fixtureDatabaseName);
    const before = await db.collection("federalBudget").findOne({ countryId: "US" });
    const first = await processDepartmentProgramSettlement(db, 10, {
      departmentProgramSliceEnabled: true,
    });
    const afterFirst = await db.collection("federalBudget").findOne({ countryId: "US" });
    const replay = await processDepartmentProgramSettlement(db, 10, {
      departmentProgramSliceEnabled: true,
    });
    const afterReplay = await db.collection("federalBudget").findOne({ countryId: "US" });
    const delivery = await loadPublicHealthDeliveryMultiplier(db, 10, true);
    const program =
      afterFirst?.departmentAccounts?.[US_HEALTH_DEPARTMENT_ID]?.programs[
        US_PUBLIC_HEALTH_PROGRAM_ID
      ];

    const assertions = {
      settledOnce: first.programsSettled === 1,
      replayAddedNoFlow:
        replay.programsSettled === 0 && replay.authorityAccrued === 0 && replay.outlaid === 0,
      replayStateIdentical: JSON.stringify(afterFirst) === JSON.stringify(afterReplay),
      treasuryUnchanged:
        before?.treasuryBalance === afterFirst?.treasuryBalance &&
        afterFirst?.treasuryBalance === afterReplay?.treasuryBalance,
      accountReconciles:
        (afterFirst?.departmentAccounts?.[US_HEALTH_DEPARTMENT_ID]?.balance ?? -1) >= 0 &&
        (afterFirst?.departmentAccounts?.[US_HEALTH_DEPARTMENT_ID]?.encumbered ?? -1) >= 0,
      outcomeUsesCurrentSettlement:
        delivery.reason === "current_settlement" &&
        delivery.multiplier === program?.implementationFactor,
    };
    if (!Object.values(assertions).every(Boolean)) {
      throw new Error(`isolated Mongo assertions failed: ${JSON.stringify(assertions)}`);
    }
    return {
      fixtureDatabasePrefix: FIXTURE_DB_PREFIX,
      defaultDatabaseUnchanged: true,
      first,
      replay,
      delivery: { multiplier: delivery.multiplier, reason: delivery.reason },
      program,
      assertions,
    };
  } finally {
    assertFixtureDatabaseName(fixtureDatabaseName);
    await client.db(fixtureDatabaseName).dropDatabase();
    const afterDefaultCollections = (
      await defaultDatabase.listCollections({}, { nameOnly: true }).toArray()
    )
      .map(({ name }) => name)
      .sort();
    if (JSON.stringify(beforeDefaultCollections) !== JSON.stringify(afterDefaultCollections)) {
      await client.close();
      throw new Error("the URI default database changed during the isolated run");
    }
    await client.close();
  }
}

if (process.argv[1]?.endsWith("publicHealthVerticalSliceMongo2026-09-20.ts")) {
  runMongoVerticalSlice()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "isolated Mongo run failed");
      process.exitCode = 1;
    });
}
