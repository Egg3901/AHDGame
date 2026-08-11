/**
 * One-shot migration: move forex-era campaign balances from anchor storage to
 * home/local currency storage while backfilling the legacy `funds` mirror.
 *
 * Why:
 * - Product expectation: campaign funds live in the character's home currency.
 * - Historical implementation: `currencyBalances.campaign` was written in
 *   anchor/internal units for forex-enabled characters.
 * - New runtime invariant: `currencyBalances.campaign` stores home currency and
 *   `funds` remains the internal/anchor mirror for compatibility.
 *
 * This migration treats the current stored `currencyBalances.campaign` value as
 * the canonical live balance for forex-enabled characters, stamps that amount
 * into `funds`, and converts the stored campaign balance into home currency
 * using current live FX.
 *
 * Safety model:
 * - Dry-run by default. Nothing is written unless `--apply` is present.
 * - Idempotent via `migrationsRun` marker. Do not re-run after apply.
 * - Warns and pauses when turns are active or processing.
 *
 * Usage:
 *   npx tsx scripts/migrations/migrate-campaign-funds-to-home-currency.ts
 *   npx tsx scripts/migrations/migrate-campaign-funds-to-home-currency.ts --apply
 *   npx tsx scripts/migrations/migrate-campaign-funds-to-home-currency.ts --db=local
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, type AnyBulkWriteOperation, type Db, type ObjectId } from "mongodb";
import {
  COUNTRY_CURRENCY_MAP,
  INITIAL_RATES,
  type CurrencyCode,
} from "../../src/lib/constants/currencies";
import type { CountryId } from "../../src/lib/constants/countries";
import type { Character, ExchangeRate } from "../../src/lib/db/types";

const MARKER_ID = "migrate-campaign-funds-to-home-currency";
const APPLY = process.argv.includes("--apply");
const DB_TARGET = process.argv.includes("--db=local") ? "local" : "live";

interface GameStateRow {
  _id: string;
  isActive?: boolean;
  isProcessing?: boolean;
}

type StoredCharacter = Pick<
  Character,
  "_id" | "countryId" | "name" | "funds" | "currencyBalances"
> & {
  _id: ObjectId;
};

function loadEnvLocal(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
  }

  dotenv.config();
}

function resolveUri(): string {
  loadEnvLocal();
  const key = DB_TARGET === "local" ? "MONGODB_URI" : "MONGODB_URI_LIVE";
  const uri = process.env[key];
  if (!uri) {
    throw new Error(`${key} not set`);
  }
  return uri;
}

async function warnIfTurnsActive(db: Db) {
  const gameState = await db.collection<GameStateRow>("gameState").findOne({ _id: "current" });
  if (gameState?.isActive || gameState?.isProcessing) {
    console.warn(
      `[${MARKER_ID}] WARNING: gameState.isActive=${gameState.isActive ?? false}, ` +
        `isProcessing=${gameState.isProcessing ?? false}. Pause turns before applying this ` +
        `migration. Continuing in 10 seconds; abort with Ctrl-C if this is unexpected.`
    );
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function main() {
  const uri = resolveUri();
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    const migrationsRun = db.collection<{ _id: string; completedAt: Date }>("migrationsRun");

    if (APPLY) {
      const marker = await migrationsRun.findOne({ _id: MARKER_ID });
      if (marker) {
        console.log(`[${MARKER_ID}] already ran at ${marker.completedAt.toISOString()}. Exiting.`);
        return;
      }
      await warnIfTurnsActive(db);
    }

    const rateDocs = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
    const rateByCountry = new Map<string, number>(
      rateDocs.map((row) => [row._id as string, row.rate])
    );

    const characters = await db
      .collection<StoredCharacter>("characters")
      .find({})
      .project<StoredCharacter>({
        _id: 1,
        name: 1,
        countryId: 1,
        funds: 1,
        currencyBalances: 1,
      })
      .toArray();

    let scanned = 0;
    let resolvable = 0;
    let alreadyMigrated = 0;
    let unresolved = 0;
    const byCountry = new Map<string, number>();
    const sample: string[] = [];
    const ops: AnyBulkWriteOperation<StoredCharacter>[] = [];

    for (const character of characters) {
      scanned += 1;

      const countryId = character.countryId as CountryId | undefined;
      const storedCampaign =
        typeof character.currencyBalances?.campaign === "number" &&
        Number.isFinite(character.currencyBalances.campaign)
          ? character.currencyBalances.campaign
          : null;
      const currentMirror =
        typeof character.funds === "number" && Number.isFinite(character.funds)
          ? character.funds
          : null;
      const sourceInternal = storedCampaign ?? currentMirror;

      if (!countryId || sourceInternal === null) {
        unresolved += 1;
        continue;
      }

      const currencyCode =
        COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
        ("USD" as CurrencyCode);
      const rate = rateByCountry.get(countryId) ?? INITIAL_RATES[countryId] ?? 1;
      if (!Number.isFinite(rate) || rate <= 0) {
        unresolved += 1;
        continue;
      }

      const targetInternal = sourceInternal;
      const targetStored = sourceInternal * rate;

      if (
        currentMirror !== null &&
        storedCampaign !== null &&
        Math.abs(currentMirror - targetInternal) < 0.0001 &&
        Math.abs(storedCampaign - targetStored) < 0.0001
      ) {
        alreadyMigrated += 1;
        continue;
      }

      resolvable += 1;
      byCountry.set(countryId, (byCountry.get(countryId) ?? 0) + 1);

      if (sample.length < 8) {
        sample.push(
          `${character.name ?? character._id.toString()} (${countryId}/${currencyCode}): ` +
            `stored ${formatNumber(storedCampaign ?? 0)} -> ${formatNumber(targetStored)}, ` +
            `mirror ${formatNumber(currentMirror ?? 0)} -> ${formatNumber(targetInternal)}`
        );
      }

      if (APPLY) {
        ops.push({
          updateOne: {
            filter: { _id: character._id },
            update: {
              $set: {
                funds: targetInternal,
                "currencyBalances.campaign": targetStored,
                updatedAt: new Date(),
              },
            },
          },
        });
      }
    }

    console.log(`\n[${MARKER_ID}] mode=${APPLY ? "APPLY" : "DRY-RUN"} db=${DB_TARGET}`);
    console.log(`  scanned           : ${scanned}`);
    console.log(`  already migrated  : ${alreadyMigrated}`);
    console.log(`  resolvable        : ${resolvable}`);
    console.log(`  unresolved        : ${unresolved}`);
    for (const [countryId, count] of [...byCountry.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      console.log(`    ${countryId}: ${count}`);
    }
    for (const line of sample) {
      console.log(`  sample            : ${line}`);
    }

    if (!APPLY) {
      console.log("\nDry-run only. Re-run with --apply to commit changes.");
      return;
    }

    let modified = 0;
    if (ops.length > 0) {
      const result = await db.collection<StoredCharacter>("characters").bulkWrite(ops, {
        ordered: false,
      });
      modified = result.modifiedCount;
    }

    await migrationsRun.insertOne({
      _id: MARKER_ID,
      completedAt: new Date(),
    });

    console.log(`\n[${MARKER_ID}] modified ${modified} character rows.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`[${MARKER_ID}] failed`, error);
  process.exitCode = 1;
});
