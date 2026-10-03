/**
 * Loads all data needed by `computeMarketDemand` into a typed snapshot.
 *
 * Phase 2: synthetic-only. Phase 3 will extend the snapshot with entity-
 * holdings inputs.
 *
 * Returns null if the country has no `federalBudget` document (e.g. invalid
 * country code or never-seeded country).
 */

import type { Db, ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { getEffectiveRate } from "@/lib/db/types/centralBank";
import { getNationalBudgetId, sovereignRolloverFromBonds } from "@/lib/bonds/sovereign";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { FX_DEPRECIATION_LOOKBACK_TURNS, RECOVERY_CREDIBILITY_RATE_DISCOUNT } from "./constants";
import { computeRequiredIssuance, requiredIssuanceFrom } from "./requiredIssuance";
import { qualifyingHoldingsFace, sumQualifyingEntitySovereignHoldings } from "./entityHoldings";
import type { SovereignDemandSnapshot } from "./types";

export async function loadCountrySovereignSnapshot(
  db: Db,
  countryCode: string,
  currentTurn: number
): Promise<SovereignDemandSnapshot | null> {
  // Reject country codes not in COUNTRY_CONFIGS up-front so getNationalBudgetId
  // doesn't crash on an unknown id. Treats unknown codes as "no budget."
  if (!COUNTRY_CONFIGS[countryCode as CountryId]) return null;

  // Use the canonical helper for the US-legacy `_id: "federal"` mapping
  // (and any future direct-election country that adopts the same convention).
  const budgetId = getNationalBudgetId(countryCode as CountryId);
  const federalBudget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budgetId });
  if (!federalBudget) return null;

  const centralBank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: countryCode });

  // `countryCode` is already known to be a real country: the COUNTRY_CONFIGS
  // guard at the top of this function returned null otherwise.
  const boards = await db
    .collection<PoliticalMetricsDoc>("politicalMetrics")
    .find({ countryId: countryCode as CountryId })
    .toArray();

  const exchangeRate = await db
    .collection<ExchangeRate>("exchangeRates")
    .findOne({ _id: countryCode });

  // Phase 3 — entity-participation inputs. Run in parallel since they're
  // independent of each other and of the existing single-doc fetches above.
  const [entityHoldings, requiredIssuance] = await Promise.all([
    sumQualifyingEntitySovereignHoldings(db, countryCode),
    computeRequiredIssuance(db, countryCode, currentTurn),
  ]);

  return assembleSovereignSnapshot({
    countryCode,
    currentTurn,
    federalBudget,
    centralBank,
    boards,
    exchangeRate,
    entityHoldings,
    requiredIssuance,
  });
}

type SnapshotBudget = Pick<
  FederalBudget,
  | "debtToGdpRatio"
  | "economicFactors"
  | "creditRating"
  | "recoveryCredibilityBonusUntilTurn"
  | "lastDefaultTurn"
>;

function assembleSovereignSnapshot(input: {
  countryCode: string;
  currentTurn: number;
  federalBudget: SnapshotBudget;
  centralBank: Pick<CentralBank, "primeRate"> | null;
  boards: Array<Pick<PoliticalMetricsDoc, "values">>;
  exchangeRate: Pick<ExchangeRate, "rate" | "rateHistory"> | null;
  entityHoldings: number;
  requiredIssuance: number;
}): SovereignDemandSnapshot {
  const { countryCode, currentTurn, federalBudget, centralBank } = input;
  return {
    countryCode,
    currentTurn,
    debtToGdp: federalBudget.debtToGdpRatio,
    // AHD stores inflationRate as percentage points (e.g. 3.94 = 3.94%; see
    // budgetCalculations.ts which divides by 100). Demand formula expects a
    // fraction (0.05 = 5%); normalize here.
    inflationRate: federalBudget.economicFactors.inflationRate / 100,
    trust: computeTrust(input.boards),
    sovereignCouponRate: applyRecoveryCredibilityBonus(
      centralBank ? getEffectiveRate(centralBank.primeRate, federalBudget.creditRating) : 0,
      federalBudget.recoveryCredibilityBonusUntilTurn ?? null,
      currentTurn
    ),
    fxDepreciationRate10t: computeFxDepreciation(input.exchangeRate, currentTurn),
    turnsSinceLastDefault:
      federalBudget.lastDefaultTurn !== null && federalBudget.lastDefaultTurn !== undefined
        ? currentTurn - federalBudget.lastDefaultTurn
        : null,
    entityHoldings: input.entityHoldings,
    requiredIssuance: input.requiredIssuance,
  };
}

/**
 * `loadCountrySovereignSnapshot` for many countries at once, for the bond
 * turn's pool pass, which needs every sovereign issuer's snapshot.
 *
 * The single-country loader issues about nine reads per country (the budget
 * three times, full sovereign bond documents twice). This reads each
 * collection once for the whole list, projected to the fields the snapshot
 * uses, and assembles the identical snapshot from them. Callers must not
 * interleave writes to these collections with the call, the same condition
 * under which the per-country loads agreed with each other.
 *
 * Every requested code gets an entry; `null` means what it means for the
 * single loader (unknown country or no national budget).
 */
export async function loadCountrySovereignSnapshots(
  db: Db,
  countryCodes: readonly string[],
  currentTurn: number
): Promise<Map<string, SovereignDemandSnapshot | null>> {
  const out = new Map<string, SovereignDemandSnapshot | null>();
  const known = [...new Set(countryCodes)].filter(
    (code) => !!COUNTRY_CONFIGS[code as CountryId]
  ) as CountryId[];
  for (const code of countryCodes) out.set(code, null);
  if (known.length === 0) return out;

  const budgetIdByCountry = new Map(known.map((code) => [code, getNationalBudgetId(code)]));
  const [budgets, centralBanks, boards, exchangeRates, imfCorp, bonds] = await Promise.all([
    db
      .collection<FederalBudget>("federalBudget")
      .find({ _id: { $in: [...budgetIdByCountry.values()] } } as never, {
        projection: {
          debtToGdpRatio: 1,
          "economicFactors.inflationRate": 1,
          creditRating: 1,
          recoveryCredibilityBonusUntilTurn: 1,
          lastDefaultTurn: 1,
          surplus: 1,
          "debt.principal": 1,
        },
      })
      .toArray(),
    db
      .collection<CentralBank>("centralBanks")
      .find({ _id: { $in: known } } as never, { projection: { primeRate: 1 } })
      .toArray(),
    // `values` whole: the trust key is the literal dotted name
    // "governance.integrity", which a projection path cannot address.
    db
      .collection<PoliticalMetricsDoc>("politicalMetrics")
      .find({ countryId: { $in: known } }, { projection: { countryId: 1, values: 1 } })
      .toArray(),
    db
      .collection<ExchangeRate>("exchangeRates")
      .find({ _id: { $in: known } } as never, { projection: { rate: 1, rateHistory: 1 } })
      .toArray(),
    db
      .collection<{ _id: ObjectId }>("corporations")
      .findOne({ imfInstitution: true }, { projection: { _id: 1 } }),
    db
      .collection<Bond>("bonds")
      .find(
        { issuerType: "sovereign", countryId: { $in: known }, matured: false, defaulted: false },
        {
          projection: {
            countryId: 1,
            maturityTurn: 1,
            totalIssued: 1,
            "holders.corporationId": 1,
            "holders.units": 1,
          },
        }
      )
      .toArray(),
  ]);

  const budgetById = new Map(budgets.map((doc) => [String(doc._id), doc]));
  const bankById = new Map(centralBanks.map((doc) => [String(doc._id), doc]));
  const rateById = new Map(exchangeRates.map((doc) => [String(doc._id), doc]));
  // Grouping keeps each country's rows in the order the query returned them,
  // the order its own single-country query would have returned them in.
  const boardsByCountry = groupBy(boards, (doc) => String(doc.countryId));
  const bondsByCountry = groupBy(bonds, (doc) => String(doc.countryId));
  const imfCorpIdStr = imfCorp?._id.toString();

  for (const code of known) {
    const federalBudget = budgetById.get(budgetIdByCountry.get(code)!);
    if (!federalBudget) continue;
    const countryBonds = bondsByCountry.get(code) ?? [];
    out.set(
      code,
      assembleSovereignSnapshot({
        countryCode: code,
        currentTurn,
        federalBudget,
        centralBank: bankById.get(code) ?? null,
        boards: boardsByCountry.get(code) ?? [],
        exchangeRate: rateById.get(code) ?? null,
        entityHoldings: qualifyingHoldingsFace(countryBonds, imfCorpIdStr),
        requiredIssuance: requiredIssuanceFrom(
          federalBudget.surplus,
          sovereignRolloverFromBonds(countryBonds, federalBudget.debt?.principal, currentTurn)
        ),
      })
    );
  }
  return out;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

/**
 * Phase 11a recovery credibility bonus: discount the country's effective
 * sovereign coupon rate by `RECOVERY_CREDIBILITY_RATE_DISCOUNT` pp while the
 * stamp is in the future. Rate is stored as percentage points (5.0 = 5%
 * APR), so the constant is subtracted directly. Floors at 0.
 */
function applyRecoveryCredibilityBonus(
  rawRate: number,
  bonusUntilTurn: number | null,
  currentTurn: number
): number {
  if (bonusUntilTurn === null || bonusUntilTurn <= currentTurn) return rawRate;
  return Math.max(0, rawRate - RECOVERY_CREDIBILITY_RATE_DISCOUNT);
}

/**
 * Mean public trust across the country's regions, normalized to 0..1.
 *
 * Reads `governance.integrity` — the board family legacy `governance.publicTrust`
 * maps onto, and the SAME family `applyLegacyTrustDelta` writes when a default,
 * a debt penalty, or civil unrest damages trust. Those two halves have to name
 * the same thing or the loop does not close: this used to average the legacy
 * `publicTrust` off a store nothing writes any more, so the demand model saw a
 * flat neutral 0.5 no matter what a country did to its own credibility.
 *
 * The board is already on the 0-100 scale the old normalization assumed, so the
 * arithmetic is unchanged.
 */
function computeTrust(boards: Array<Pick<PoliticalMetricsDoc, "values">>): number {
  if (boards.length === 0) return 0.5; // neutral if missing
  const sum = boards.reduce((acc, doc) => acc + (doc.values?.["governance.integrity"] ?? 50), 0);
  return Math.max(0, Math.min(1, sum / boards.length / 100));
}

function computeFxDepreciation(
  exchangeRate: Pick<ExchangeRate, "rate" | "rateHistory"> | null,
  currentTurn: number
): number {
  if (!exchangeRate || !exchangeRate.rateHistory || exchangeRate.rateHistory.length === 0) {
    return 0;
  }
  const lookbackTurn = currentTurn - FX_DEPRECIATION_LOOKBACK_TURNS;
  // Find the snapshot at or before lookbackTurn — fallback to oldest available
  const sorted = [...exchangeRate.rateHistory].sort((a, b) => a.turn - b.turn);
  const past = sorted.find((s) => s.turn >= lookbackTurn) ?? sorted[0];
  if (!past || past.rate === 0) return 0;
  // Higher current rate = local currency weaker (more local per anchor) = depreciation
  const depreciation = (exchangeRate.rate - past.rate) / past.rate;
  return Math.max(0, depreciation);
}
