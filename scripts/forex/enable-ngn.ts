/**
 * Live-DB migration: finish enabling NGN on the forex system.
 *
 * The code change (adding NG/NGN to the forex-active lists) makes the naira
 * tradeable, but two pieces of live state are needed for it to work end-to-end:
 *
 *   1. An NG `exchangeRates` doc — already seeded by seedNgBudgets() (the 1550
 *      rate in the ticker). Ensured here for robustness; never overwritten.
 *   2. An NG `centralBanks` doc — NOT created by the single-shot
 *      `/api/admin/forex/enable` endpoint (it 400s once forex is enabled), and
 *      `forexTurn` SKIPS any country with no bank doc, so without this the naira
 *      rate never drifts and FX revenue never accrues.
 *   3. Starting FX reserves — so the CBN chair has a war chest to defend the band.
 *
 * Partial-doc heal: if a player traded NGN before this ran, `distributeSpreadFee`
 * will have upserted a *partial* bank doc (forexRevenue / spreadFeeReserveBalances
 * only) via `{ upsert: true }`. A `$setOnInsert` seed would then silently no-op and
 * leave the doc missing primeRate/histories. This script fills only the MISSING
 * canonical fields via `$set`, preserving any accumulated revenue/reserves.
 *
 * Usage (dry-run by default — prints the plan, writes nothing):
 *
 *   npx tsx scripts/forex/enable-ngn.ts
 *   npx tsx scripts/forex/enable-ngn.ts --apply
 *
 * Point MONGODB_URI in .env.local at the target database before running.
 */
import * as dotenv from "dotenv";
import { connectDb, closeDb } from "../utils/db";
import { COUNTRY_CURRENCY_MAP, getInitialRates, INITIAL_RATES } from "@/lib/constants/currencies";
import { getBankId, buildCentralBankBootstrapUpdate } from "@/lib/centralBank/helpers";
import type { CentralBank, ExchangeRate, GameState } from "@/lib/db/types";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

/** Mirrors FALLBACK_RESERVE_SEED.NG in src/app/api/admin/forex/seed-reserves/route.ts.
 *  ~2T naira ≈ 1.3B USD at the 1550 starting rate. Keep the two in sync if tuned. */
const NG_RESERVE_SEED = 2_000_000_000_000;

function logPlan(action: string) {
  console.log(`${APPLY ? "  APPLY " : "  DRY   "}${action}`);
}

async function main() {
  console.log(`\nEnable NGN forex — ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`);
  const db = await connectDb();
  const now = new Date();

  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const preset = gs?.preset ?? DEFAULT_SEED_PRESET;
  const ngRate = getInitialRates(preset)["NG"] ?? INITIAL_RATES["NG"] ?? 1550;

  // ── 1. NG exchangeRates doc ────────────────────────────────────────────────
  const exRate = await db.collection<ExchangeRate>("exchangeRates").findOne({ _id: "NG" as never });
  if (!exRate) {
    logPlan(`create exchangeRates/NG (rate ${ngRate} NGN, preset ${preset})`);
    if (APPLY) {
      await db.collection<ExchangeRate>("exchangeRates").updateOne(
        { _id: "NG" as never },
        {
          $setOnInsert: {
            _id: "NG",
            countryId: "NG",
            currencyCode: COUNTRY_CURRENCY_MAP["NG"],
            rate: ngRate,
            baseRate: ngRate,
            macroTarget: ngRate,
            rateHistory: [],
            buyVolume24: 0,
            sellVolume24: 0,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    }
  } else {
    console.log(`  OK    exchangeRates/NG exists (rate ${exRate.rate}) — left untouched`);
  }

  // ── 2. NG centralBanks doc (create or heal partial) ────────────────────────
  const bankId = getBankId("NG"); // "NG" — CBN has no shared bank / intorg
  const canonical = buildCentralBankBootstrapUpdate("NG", bankId, undefined, now)
    .$setOnInsert as Record<string, unknown>;
  const existingBank = (await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: bankId as never })) as Record<string, unknown> | null;

  if (!existingBank) {
    logPlan(`create centralBanks/${bankId} (primeRate ${canonical.primeRate}, forexRevenue 0)`);
    if (APPLY) {
      await db
        .collection<CentralBank>("centralBanks")
        .insertOne({ ...canonical, forexRevenue: 0, tradeGrowth: 0 } as never);
    }
  } else {
    // Heal: fill only canonical fields the existing (possibly partial) doc lacks.
    const missing: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(canonical)) {
      if (key === "_id") continue;
      if (existingBank[key] === undefined) missing[key] = value;
    }
    if (existingBank.forexRevenue === undefined) missing.forexRevenue = 0;
    if (existingBank.tradeGrowth === undefined) missing.tradeGrowth = 0;

    if (Object.keys(missing).length === 0) {
      console.log(`  OK    centralBanks/${bankId} already complete — left untouched`);
    } else {
      logPlan(
        `heal centralBanks/${bankId} — fill missing fields: ${Object.keys(missing).join(", ")}`
      );
      if (APPLY) {
        await db
          .collection<CentralBank>("centralBanks")
          .updateOne({ _id: bankId as never }, { $set: { ...missing, updatedAt: now } });
      }
    }
  }

  // ── 3. Starting FX reserves ────────────────────────────────────────────────
  const currentReserve = ((existingBank?.reserveBalance as number | undefined) ?? 0) || 0;
  if (currentReserve > 0) {
    console.log(
      `  OK    centralBanks/${bankId}.reserveBalance = ${currentReserve} — left untouched`
    );
  } else {
    logPlan(`seed centralBanks/${bankId}.reserveBalance = ${NG_RESERVE_SEED} (~2T naira)`);
    if (APPLY) {
      await db
        .collection<CentralBank>("centralBanks")
        .updateOne(
          { _id: bankId as never },
          { $set: { reserveBalance: NG_RESERVE_SEED, updatedAt: now } }
        );
    }
  }

  console.log(
    `\n${APPLY ? "Done — NGN forex state seeded." : "Dry run complete — re-run with --apply to write."}\n`
  );
  await closeDb();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb().catch(() => {});
  process.exit(1);
});
