// src/lib/currency/migration.ts
// Migration logic for enabling the forex system.
// Called by POST /api/admin/forex/enable — each function is idempotent.
import type { Db } from "mongodb";
import {
  COUNTRY_CURRENCY_MAP,
  FOREX_ACTIVE_COUNTRIES,
  INITIAL_RATES,
  getInitialRates,
  getSeedHardPeg,
} from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";

const BATCH_SIZE = 500;

// ── Character balance migration ─────────────────────────────────────────────────

export interface MigrationResult {
  processed: number;
  skipped: number;
}

/**
 * Migrate all existing characters to have currencyBalances.
 * Reads funds and cashOnHand, creates currencyBalances in the character's home currency.
 * Idempotent: skips characters that already have currencyBalances.
 * Does NOT unset funds/cashOnHand — `funds` remains as the internal/anchor
 * mirror while `currencyBalances.campaign` becomes the stored home-currency
 * campaign balance.
 */
export async function migrateCharacterBalances(db: Db): Promise<MigrationResult> {
  const col = db.collection("characters");
  const cursor = col
    .find({})
    .project({ _id: 1, countryId: 1, funds: 1, cashOnHand: 1, currencyBalances: 1 })
    .batchSize(BATCH_SIZE);

  let processed = 0;
  let skipped = 0;
  let batch: ReturnType<typeof buildCharacterUpdateOp>[] = [];

  for await (const doc of cursor) {
    // Idempotent: skip if already migrated
    if (doc.currencyBalances) {
      skipped++;
      continue;
    }

    // Guard: skip characters with countryId not in COUNTRY_CURRENCY_MAP
    if (!COUNTRY_CURRENCY_MAP[doc.countryId as CountryId]) {
      skipped++;
      continue;
    }
    const op = buildCharacterUpdateOp(
      doc as unknown as { _id: unknown; countryId: CountryId; funds: number; cashOnHand?: number }
    );
    batch.push(op);

    if (batch.length >= BATCH_SIZE) {
      await col.bulkWrite(batch as never, { ordered: false });
      processed += batch.length;
      batch = [];
    }
  }

  // Flush remaining batch
  if (batch.length > 0) {
    await col.bulkWrite(batch as never, { ordered: false });
    processed += batch.length;
  }

  return { processed, skipped };
}

/**
 * Build a single bulkWrite updateOne operation for a character document.
 * Maps countryId -> home currency via COUNTRY_CURRENCY_MAP and converts the
 * pre-forex `cashOnHand` and `funds` (both internal units) to the home
 * currency by multiplying through INITIAL_RATES — mirroring the conversion
 * `migrateCorporationLiquidCapital` applies to corp liquidCapital so
 * characters and corporations stay consistent post-migration.
 */
function buildCharacterUpdateOp(doc: {
  _id: unknown;
  countryId: CountryId;
  funds: number;
  cashOnHand?: number;
}) {
  const homeCurrency = COUNTRY_CURRENCY_MAP[doc.countryId];
  const homeRate = INITIAL_RATES[doc.countryId] ?? 1;
  const cashOnHand = doc.cashOnHand ?? 0;
  const convertedCash = cashOnHand * homeRate;
  const convertedCampaignFunds = doc.funds * homeRate;

  return {
    updateOne: {
      filter: { _id: doc._id },
      update: {
        $set: {
          funds: doc.funds,
          "currencyBalances.campaign": convertedCampaignFunds,
          "currencyBalances.personal": { [homeCurrency]: convertedCash },
          displayCurrencyPreference: "local" as const,
          autoConvertEnabled: true,
          updatedAt: new Date(),
        },
      },
    },
  };
}

// ── Exchange rate seeding ───────────────────────────────────────────────────────

/**
 * Seed ExchangeRate documents for US, UK, JP.
 * Uses upsert to be idempotent — if documents already exist, they are not overwritten.
 */
export async function seedExchangeRates(db: Db, preset: string): Promise<void> {
  const rates = getInitialRates(preset);
  const ops = FOREX_ACTIVE_COUNTRIES.map((countryId) => {
    const rate = rates[countryId]!;
    const currencyCode = COUNTRY_CURRENCY_MAP[countryId];
    const hardPeg = getSeedHardPeg(countryId, preset);

    return {
      updateOne: {
        filter: { _id: countryId },
        update: {
          $setOnInsert: {
            countryId,
            currencyCode,
            rate,
            baseRate: rate,
            macroTarget: rate,
            rateHistory: [],
            buyVolume24: 0,
            sellVolume24: 0,
            ...(hardPeg != null ? { hardPeg } : {}),
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    };
  });

  // exchangeRates uses string _id (CountryId), not ObjectId
  await db.collection("exchangeRates").bulkWrite(ops as never);
}

// ── Central bank updates ────────────────────────────────────────────────────────

/**
 * Ensure all forex-active central bank documents exist and have the required
 * forexRevenue / tradeGrowth fields. Safe to run multiple times — upsert is
 * idempotent; $setOnInsert only fires on document creation so existing
 * accumulated forexRevenue on US/UK/JP is not wiped on re-runs.
 *
 * Previously this hardcoded ["US","UK","JP"] and omitted DE, which caused EUR
 * spread fees to be silently dropped (updateOne no-ops when the document is absent).
 */
export async function updateCentralBanks(db: Db): Promise<void> {
  const now = new Date();
  // centralBanks uses string _id, resolved via getBankId so shared banks (e.g.
  // ECB for DE) map to the canonical document instead of per-country dupes.
  await db.collection("centralBanks").bulkWrite(
    FOREX_ACTIVE_COUNTRIES.map((countryId) => {
      const bankId = getBankId(countryId);
      return {
        updateOne: {
          filter: { _id: bankId as never },
          update: {
            $set: { tradeGrowth: 0, updatedAt: now },
            $setOnInsert: {
              _id: bankId,
              countryId,
              chairCharacterId: null,
              chairCharacterName: null,
              chairAppointedAt: null,
              chairAppointedBy: null,
              primeRate: COUNTRY_CONFIGS[countryId].centralBank.defaultPrimeRate,
              rateHistory: [],
              forexRevenue: 0,
              chairInfamy: 0,
              chairTermExpiresAtTurn: null,
              nominations: [],
              lobbyingPool: [],
              interestRateHistory: [],
              inflationHistory: [],
              gdpGrowthHistory: [],
              createdAt: now,
            },
          },
          upsert: true,
        },
      };
    })
  );
}

// ── Corporation balance migration ───────────────────────────────────────────────

/**
 * Convert corporation liquidCapital from USD to the corp's home currency.
 * Uses exchange rates seeded by seedExchangeRates — MUST run after that step.
 * Idempotent: skips corps that already have liquidCurrencyCode set.
 *
 * Rate formula: newHomeAmount = usdAmount × homeRate
 * (Since USD rate = 1.0, homeRate is the direct multiplier.)
 */
export async function migrateCorporationLiquidCapital(db: Db): Promise<MigrationResult> {
  // Load exchange rates (seeded in prior step)
  const rateEntries = await db.collection("exchangeRates").find({}).toArray();
  const rateByCountry = new Map(
    (rateEntries as unknown as { countryId: string; rate: number; currencyCode: string }[]).map(
      (r) => [r.countryId, { rate: r.rate, currencyCode: r.currencyCode }]
    )
  );

  const col = db.collection("corporations");
  const cursor = col
    .find({})
    .project({ _id: 1, countryId: 1, liquidCapital: 1, liquidCurrencyCode: 1 })
    .batchSize(BATCH_SIZE);

  let processed = 0;
  let skipped = 0;
  const batch: object[] = [];

  for await (const corp of cursor) {
    // Idempotent: skip if already migrated
    if (corp.liquidCurrencyCode) {
      skipped++;
      continue;
    }

    const entry = rateByCountry.get(corp.countryId);
    if (!entry) {
      // Unknown country — skip, don't corrupt the balance
      skipped++;
      continue;
    }

    const { rate, currencyCode } = entry;
    // USD is the reference (rate = 1.0), so newAmount = liquidCapital × homeRate
    const convertedCapital = Math.round(corp.liquidCapital * rate);

    batch.push({
      updateOne: {
        filter: { _id: corp._id },
        update: {
          $set: {
            liquidCurrencyCode: currencyCode,
            liquidCapital: convertedCapital,
          },
        },
      },
    });
    processed++;
  }

  if (batch.length > 0) {
    await col.bulkWrite(batch as Parameters<typeof col.bulkWrite>[0]);
  }

  return { processed, skipped };
}

// ── Index creation ──────────────────────────────────────────────────────────────

/**
 * Create indexes needed by the forex trading system.
 * createIndex is idempotent — if the index already exists, it's a no-op.
 */
export async function createForexIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection("tradeHistory").createIndex({ turn: -1 }, { background: true }),
    db
      .collection("tradeHistory")
      .createIndex({ buyerCharacterId: 1, turn: -1 }, { background: true }),
    db
      .collection("currencyOrders")
      .createIndex({ status: 1, expiresAtTurn: 1 }, { background: true }),
  ]);
}
