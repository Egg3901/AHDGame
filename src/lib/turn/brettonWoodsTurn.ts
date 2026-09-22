/**
 * Bretton Woods exit turn phase (issue #7) — shell around
 * `src/lib/monetary/brettonWoods.ts`.
 *
 * The rules module is complete, tested and flagged on, but nothing called it:
 * the world was flagged for a monetary regime change that could never happen.
 * This phase is the wiring. It runs every turn while `brettonWoodsExitEnabled`
 * is on (fail-safe: flag off or absent ⇒ a single gameConfig read and zero
 * writes, byte-identical to the pegged world), positioned after inflationRecalc
 * (which settles the US inflation gap this turn's drain reads) and before
 * forexTurn (which applies the persisted regime's band and drift).
 *
 * Per-turn work:
 * 1. Step US gold cover from foreign dollar claims (non-US central banks' USD
 *    spread-fee reserves, valued in the internal anchor off the live USD rate)
 *    against the US reserve position, plus the US inflation gap. Cover is
 *    tracked on the USD exchange-rate row; absent = full cover (1).
 * 2. Suspend convertibility once the cover is exhausted in an eligible year:
 *    every participating pegged currency (see `participatesInFloat` — command
 *    economies never leave the peg) moves to `suspended`, stamped this turn.
 * 3. Float suspended currencies once they have served the transition.
 *
 * Sourcing notes (documented proxies, not new mechanics — the formulas,
 * thresholds and coefficients are untouched in the rules module):
 * - There is no US gold-stock field anywhere in the schema, so the reserve
 *   side is the US central-bank reserve position (`reserveBalance` +
 *   `forexRevenue`) in USD face, converted at the live USD rate. Both sides
 *   are then in the same internal units, so the claims/cover ratio the drain
 *   reads is well-scaled without a new constant.
 * - No reserve signal (US position absent or non-positive) means no new
 *   information, so the claims term holds cover flat rather than inventing
 *   pressure; the inflation gap can still erode it.
 * - Worlds without exchange-rate rows yet (first turn, before forexTurn seeds
 *   them) track nothing — one turn of drain, worth thousandths of cover, is
 *   skipped rather than persisted somewhere the readers never look.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { FederalBudget } from "@/lib/db/types/budget";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getInflationTarget } from "@/lib/budget/inflation";
import {
  participatesInFloat,
  resolveMonetaryRegime,
  shouldFloat,
  shouldSuspendConvertibility,
  stepGoldCover,
} from "@/lib/monetary/brettonWoods";
import { isBrettonWoodsExitEnabled } from "@/lib/monetary/featureFlag";

export interface BrettonWoodsTurnResult {
  /** False when the flag is off — nothing was read past gameConfig, nothing written. */
  enabled: boolean;
  /** Stepped US gold cover, or null when there was no USD row to track it on. */
  goldCover: number | null;
  /** Country ids that suspended convertibility this turn. */
  suspended: CountryId[];
  /** Country ids that entered the float this turn. */
  floated: CountryId[];
  /** Exchange-rate rows considered. */
  currenciesProcessed: number;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function processBrettonWoodsTurn(
  db: Db,
  currentTurn: number,
  currentYear: number | null | undefined
): Promise<BrettonWoodsTurnResult> {
  const empty: BrettonWoodsTurnResult = {
    enabled: false,
    goldCover: null,
    suspended: [],
    floated: [],
    currenciesProcessed: 0,
  };

  const gameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne(
      { _id: "default" },
      { projection: { brettonWoodsExitEnabled: 1, commandEconomyEnabled: 1 } }
    );
  if (!isBrettonWoodsExitEnabled(gameConfig)) return empty;
  const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;

  // Small rows, but rateHistory is chart ballast this phase never reads —
  // project the six fields the transition actually uses.
  const rateDocs = await db
    .collection<ExchangeRate>("exchangeRates")
    .find(
      {},
      {
        projection: {
          countryId: 1,
          currencyCode: 1,
          rate: 1,
          monetaryRegime: 1,
          monetaryRegimeSetAtTurn: 1,
          goldCover: 1,
        },
      }
    )
    .toArray();
  if (rateDocs.length === 0) return { ...empty, enabled: true };

  const usDoc = rateDocs.find((doc) => doc.countryId === "US");
  const usdRate = usDoc && finiteOr(usDoc.rate, NaN) > 0 ? (usDoc.rate as number) : NaN;
  const toInternal = (faceUsd: number): number =>
    Number.isFinite(usdRate) && usdRate > 0 ? faceUsd / (usdRate as number) : 0;

  // Foreign dollar claims and the US reserve position share one projected read.
  // Only the FX reserve bucket counts as claims (same definition the reserve-
  // currency ranking uses); the home lending reserve is domestic, not a claim.
  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find(
      {},
      {
        projection: {
          countryId: 1,
          spreadFeeReserveBalances: 1,
          reserveBalance: 1,
          forexRevenue: 1,
        },
      }
    )
    .toArray();
  let foreignClaims = 0;
  let usReservesFace = 0;
  for (const bank of banks) {
    const usdHeld = finiteOr(bank.spreadFeeReserveBalances?.["USD" as CurrencyCode], 0);
    if (bank.countryId === "US") {
      usReservesFace = finiteOr(bank.reserveBalance, 0) + finiteOr(bank.forexRevenue, 0);
    } else if (usdHeld > 0) {
      foreignClaims += toInternal(usdHeld);
    }
  }
  const goldValue = toInternal(Math.max(0, usReservesFace));
  const hasReserveSignal = Number.isFinite(goldValue) && goldValue > 0;

  // This turn's US inflation gap — inflationRecalc ran earlier in the sequence,
  // so the budget row already carries the settled rate.
  const usBudget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne(
      { _id: getNationalBudgetId("US") },
      { projection: { "economicFactors.inflationRate": 1 } }
    );
  const usInflation = finiteOr(usBudget?.economicFactors?.inflationRate, NaN);
  const inflationGap =
    Number.isFinite(usInflation) && currentYear != null
      ? (usInflation as number) - getInflationTarget("US", currentYear)
      : 0;

  const prevCover = usDoc ? finiteOr(usDoc.goldCover, 1) : 1;
  const goldCover = stepGoldCover({
    cover: prevCover,
    foreignClaims: hasReserveSignal ? foreignClaims : 0,
    goldValue: hasReserveSignal ? (goldValue as number) : 1,
    inflationGap,
  });

  const usdRegime = resolveMonetaryRegime(usDoc?.monetaryRegime);
  const suspendNow =
    usDoc != null && shouldSuspendConvertibility({ currentYear, goldCover, regime: usdRegime });

  const suspended: CountryId[] = [];
  const floated: CountryId[] = [];
  const regimeWrites: Array<{ countryId: CountryId; regime: "suspended" | "floating" }> = [];
  for (const doc of rateDocs) {
    const countryId = doc.countryId as CountryId;
    if (!countryId) continue;
    if (
      !participatesInFloat(
        countryId,
        isCommandEconomy(countryId, currentYear, commandEconomyEnabled)
      )
    ) {
      continue;
    }
    const regime = resolveMonetaryRegime(doc.monetaryRegime);
    if (suspendNow && regime === "pegged") {
      regimeWrites.push({ countryId, regime: "suspended" });
      suspended.push(countryId);
    } else if (
      regime === "suspended" &&
      shouldFloat({
        regime,
        turnsSinceRegimeChange: currentTurn - finiteOr(doc.monetaryRegimeSetAtTurn, currentTurn),
      })
    ) {
      regimeWrites.push({ countryId, regime: "floating" });
      floated.push(countryId);
    }
  }

  // One bulk write: the stepped cover on the USD row plus every transition.
  // Sorted by country id so the write order (and the reported lists) are
  // deterministic replay to replay. Skipped entirely when there is nothing to
  // persist (no USD row and no transitions) — an empty bulkWrite throws.
  regimeWrites.sort((a, b) => (a.countryId < b.countryId ? -1 : a.countryId > b.countryId ? 1 : 0));
  suspended.sort();
  floated.sort();
  const now = new Date();
  const ops = [
    ...(usDoc
      ? [
          {
            updateOne: {
              filter: { _id: usDoc._id },
              update: { $set: { goldCover, updatedAt: now } },
            },
          },
        ]
      : []),
    ...regimeWrites.map((write) => ({
      updateOne: {
        filter: { countryId: write.countryId },
        update: {
          $set: {
            monetaryRegime: write.regime,
            monetaryRegimeSetAtTurn: currentTurn,
            updatedAt: now,
          },
        },
      },
    })),
  ];
  if (ops.length > 0) {
    await db.collection<ExchangeRate>("exchangeRates").bulkWrite(ops);
  }

  return {
    enabled: true,
    goldCover: usDoc ? goldCover : null,
    suspended,
    floated,
    currenciesProcessed: rateDocs.length,
  };
}
