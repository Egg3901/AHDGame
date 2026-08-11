/**
 * One-off seeder for CN / IE / BR economic infrastructure on prod.
 *
 * Runs:
 *  - Per-country: regions, state metrics, baselines, budgets (federal+state+sovereign-issuer corps+base laws)
 *  - Cross-country: state resource capacity (idempotent), unowned sectors (insert-only)
 *  - Country-scoped sector specializations for CN/IE/BR only (avoids touching open countries)
 *  - BR central bank doc (CN/IE shells already exist)
 *  - Exchange rate docs for CN (CNY) and BR (BRL); IE shares DE's EUR doc by design
 *
 * Does NOT touch: parties, demographics, government formation, seats, statePartyOrg,
 * legislation types, ECB migration, DE/JP/UK/US data.
 */
import * as fs from "fs";
import * as path from "path";
import { MongoClient, type Db } from "mongodb";
import type { State } from "@/lib/db/types";
import {
  seedCNRegions,
  seedCNStateMetrics,
  seedCNBaselines,
  seedIERegions,
  seedIEStateMetrics,
  seedIEBaselines,
  seedBRRegions,
  seedBRStateMetrics,
  seedBRBaselines,
  seedCnBudgets,
  seedIeBudgets,
  seedBrBudgets,
  seedUnownedSectors,
  seedStateResourceCapacity,
} from "@/lib/admin/seed";
import { inferStateSectorSpecialization } from "@/lib/admin/seed/seedStateSectorSpecializations";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Era preset for this one-off script. Previously each seeder's `preset`
 * parameter defaulted to "2019-default", so running this against a historical
 * world silently wrote modern data. Now explicit and overridable:
 *   SEED_PRESET=1953-default npx tsx <this script>
 */
const PRESET = process.env.SEED_PRESET ?? DEFAULT_SEED_PRESET;

function readMongoUri(): string {
  const envPath = path.join(process.cwd(), ".env.local");
  const envContent = fs.readFileSync(envPath, "utf-8");
  const match = envContent.match(/MONGODB_URI(?:_LIVE)?=("?)([^"\r\n]+)\1/);
  if (!match?.[2]) throw new Error("MONGODB_URI not found in .env.local");
  return match[2].trim();
}

const log = (msg: string) => console.log("  " + msg);
const phase = (n: string, name: string) => console.log(`\n=== ${n}: ${name} ===`);

/**
 * Country-scoped clone of seedStateSectorSpecializations: only writes
 * sectorSpecializations for the supplied countryIds, leaving open-country
 * state docs alone.
 */
async function seedSectorSpecializationsForCountries(
  db: Db,
  countryIds: string[],
  logger: (msg: string) => void
) {
  const states = await db
    .collection<State>("states")
    .find({ countryId: { $in: countryIds } } as never)
    .toArray();
  if (states.length === 0) {
    logger("No matching states — run regional seeders first");
    return;
  }
  const now = new Date();
  const ops = states.map((state) => {
    const specialization = inferStateSectorSpecialization(state);
    return {
      updateOne: {
        filter: { _id: state._id },
        update: {
          $set: {
            "sectorSpecializations.primary": specialization.primary,
            "sectorSpecializations.secondary": specialization.secondary,
            "sectorSpecializations.updatedAt": now,
          },
        },
      },
    };
  });
  await db.collection("states").bulkWrite(ops as never);
  logger(`Seeded sector specializations for ${states.length} states (CN/IE/BR only)`);
}

async function ensureBrCentralBank(db: Db, logger: (msg: string) => void) {
  const existing = await db.collection("centralBanks").findOne({ _id: "BR" } as never);
  if (existing) {
    logger("BR central bank doc already exists, skipping");
    return;
  }
  const gameState = await db.collection("gameState").findOne({ _id: "current" } as never);
  const currentTurn = (gameState as { currentTurn?: number } | null)?.currentTurn ?? 424;
  const startTurn = currentTurn - 11;
  const inflationHistory = Array.from({ length: 12 }, (_, i) => ({
    turn: startTurn + i,
    rate: 4.5,
  }));
  const gdpGrowthHistory = Array.from({ length: 12 }, (_, i) => ({
    turn: startTurn + i,
    rate: 2.5,
  }));
  const interestRateHistory = Array.from({ length: 12 }, (_, i) => ({
    turn: startTurn + i,
    rate: 10.5,
  }));
  const savingsFlowHistory = Array.from({ length: 12 }, (_, i) => ({
    turn: startTurn + i,
    rate: 0,
  }));
  const now = new Date();
  await db.collection("centralBanks").insertOne({
    _id: "BR",
    countryId: "BR",
    chairCharacterId: null,
    chairCharacterName: null,
    chairAppointedAt: null,
    chairAppointedBy: null,
    chairInfamy: 0,
    chairTermExpiresAtTurn: null,
    primeRate: 10.5,
    rateHistory: [],
    nominations: [],
    lobbyingPool: [],
    interestRateHistory,
    inflationHistory,
    gdpGrowthHistory,
    savingsFlowHistory,
    createdAt: now,
    updatedAt: now,
  } as never);
  logger(
    `Created BR central bank doc (primeRate=10.5, 12 turns of placeholder history starting turn ${startTurn})`
  );
}

async function ensureExchangeRate(
  db: Db,
  countryId: string,
  currencyCode: string,
  baseRate: number,
  logger: (msg: string) => void
) {
  const existing = await db.collection("exchangeRates").findOne({ _id: countryId } as never);
  if (existing) {
    logger(`${countryId} exchange rate doc already exists, skipping`);
    return;
  }
  const now = new Date();
  await db.collection("exchangeRates").insertOne({
    _id: countryId,
    countryId,
    currencyCode,
    rate: baseRate,
    baseRate,
    macroTarget: baseRate,
    rateHistory: [],
    buyVolume24: 0,
    sellVolume24: 0,
    updatedAt: now,
  } as never);
  logger(`Created exchange rate doc for ${countryId} (${currencyCode}, rate=${baseRate})`);
}

async function main() {
  const client = new MongoClient(readMongoUri());
  await client.connect();
  const db = client.db("a-house-divided");

  try {
    phase("Phase 1", "CN — regions → metrics → baselines → budgets");
    await seedCNRegions(db, false, log, PRESET);
    await seedCNStateMetrics(db, false, log, PRESET);
    await seedCNBaselines(db, false, log, PRESET);
    await seedCnBudgets(db, false, log, PRESET);

    phase("Phase 2", "IE — regions → metrics → baselines → budgets");
    await seedIERegions(db, false, log, PRESET);
    await seedIEStateMetrics(db, false, log, PRESET);
    await seedIEBaselines(db, false, log, PRESET);
    await seedIeBudgets(db, false, log, PRESET);

    phase("Phase 3", "BR — regions → metrics → baselines → budgets");
    await seedBRRegions(db, false, log, PRESET);
    await seedBRStateMetrics(db, false, log, PRESET);
    await seedBRBaselines(db, false, log, PRESET);
    await seedBrBudgets(db, false, log, PRESET);

    phase("Phase 4", "Cross-country — resource capacity");
    await seedStateResourceCapacity(db, false, log, PRESET);

    phase("Phase 5", "Cross-country — sector specializations (CN/IE/BR only)");
    await seedSectorSpecializationsForCountries(db, ["CN", "IE", "BR"], log);

    phase("Phase 6", "Cross-country — unowned sectors (insert-only)");
    await seedUnownedSectors(db, log, 1, PRESET);

    phase("Phase 7", "Central banks — create BR doc (CN/IE shells already exist)");
    await ensureBrCentralBank(db, log);

    phase("Phase 8", "Exchange rates — CN (CNY) + BR (BRL); IE inherits DE's EUR doc");
    await ensureExchangeRate(db, "CN", "CNY", 7.2, log);
    await ensureExchangeRate(db, "BR", "BRL", 5.0, log);

    phase("VERIFY", "Post-seed counts per country");
    for (const cid of ["CN", "IE", "BR"]) {
      const states = await db.collection("states").countDocuments({ countryId: cid });
      const sm = await db.collection("stateMetrics").countDocuments({ countryId: cid });
      const smb = await db.collection("stateMetricBaselines").countDocuments({ countryId: cid });
      const fb = await db.collection("federalBudget").countDocuments({ countryId: cid });
      const sbu = await db.collection("stateBudgets").countDocuments({ countryId: cid });
      const corps = await db.collection("corporations").countDocuments({ countryId: cid });
      const cs = await db.collection("corporateSectors").countDocuments({ countryId: cid });
      const us = await db.collection("unownedSectors").countDocuments({ countryId: cid });
      const src = await db.collection("stateResourceCapacity").countDocuments({ countryId: cid });
      const enacted = await db.collection("enactedLaws").countDocuments({ countryId: cid });
      const cb = await db
        .collection("centralBanks")
        .findOne({ _id: cid } as never, { projection: { primeRate: 1 } });
      const xr = await db
        .collection("exchangeRates")
        .findOne({ _id: cid } as never, { projection: { currencyCode: 1, rate: 1 } });
      console.log(`  ${cid}:`, {
        states,
        stateMetrics: sm,
        stateMetricBaselines: smb,
        federalBudget: fb,
        stateBudgets: sbu,
        corporations: corps,
        corporateSectors: cs,
        unownedSectors: us,
        stateResourceCapacity: src,
        enactedLaws: enacted,
        centralBank: cb ? `primeRate=${(cb as { primeRate?: number }).primeRate}` : "MISSING",
        exchangeRate: xr
          ? `${(xr as { currencyCode?: string; rate?: number }).currencyCode}=${(xr as { currencyCode?: string; rate?: number }).rate}`
          : cid === "IE"
            ? "n/a (uses DE EUR)"
            : "MISSING",
      });
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
