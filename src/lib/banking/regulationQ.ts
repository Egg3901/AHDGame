import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { BankCharter } from "@/lib/db/types/bank";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import type { BankingLawDoc, RateCorridor } from "@/lib/banking/separationLaw";

/**
 * Provisional Regulation Q corridor defaults - flagged for user review.
 * Offsets are percentage points relative to the central-bank prime rate.
 *
 * Historical worlds (era unit scale > 1) use a Reg-Q style deposit ceiling
 * strictly below prime; modern worlds allow a small deposit premium.
 */
export const HISTORICAL_DEPOSIT_CORRIDOR: RateCorridor = {
  minOffset: -4.0,
  maxOffset: -0.5,
};

/** Provisional - flagged for user review. */
export const HISTORICAL_LENDING_CORRIDOR: RateCorridor = {
  minOffset: 0.5,
  maxOffset: 6.0,
};

/** Provisional - flagged for user review. */
export const MODERN_DEPOSIT_CORRIDOR: RateCorridor = {
  minOffset: -4.0,
  maxOffset: 0.5,
};

/** Provisional - flagged for user review. */
export const MODERN_LENDING_CORRIDOR: RateCorridor = {
  minOffset: 0.25,
  maxOffset: 8.0,
};

export type RateCorridors = {
  deposit: RateCorridor;
  lending: RateCorridor;
};

function isHistoricalEra(eraUnitScale: number): boolean {
  return eraUnitScale > 1;
}

/**
 * Deposit-rate offset corridor for `countryId` (pp vs prime).
 * Per-country `bankingLaws.depositCorridor` override wins; else era default.
 */
export async function getDepositRateCorridor(db: Db, countryId: CountryId): Promise<RateCorridor> {
  const law = await db
    .collection<BankingLawDoc>("bankingLaws")
    .findOne({ _id: countryId }, { projection: { depositCorridor: 1 } });
  if (law?.depositCorridor) {
    return law.depositCorridor;
  }
  const eraUnitScale = await loadWorldEraUnitScale(db);
  return isHistoricalEra(eraUnitScale) ? HISTORICAL_DEPOSIT_CORRIDOR : MODERN_DEPOSIT_CORRIDOR;
}

/**
 * Lending-rate offset corridor for `countryId` (pp vs prime).
 * Per-country `bankingLaws.lendingCorridor` override wins; else era default.
 */
export async function getLendingRateCorridor(db: Db, countryId: CountryId): Promise<RateCorridor> {
  const law = await db
    .collection<BankingLawDoc>("bankingLaws")
    .findOne({ _id: countryId }, { projection: { lendingCorridor: 1 } });
  if (law?.lendingCorridor) {
    return law.lendingCorridor;
  }
  const eraUnitScale = await loadWorldEraUnitScale(db);
  return isHistoricalEra(eraUnitScale) ? HISTORICAL_LENDING_CORRIDOR : MODERN_LENDING_CORRIDOR;
}

/** Both corridors for a country (one era-scale read when both fall back). */
export async function getRateCorridors(db: Db, countryId: CountryId): Promise<RateCorridors> {
  const law = await db
    .collection<BankingLawDoc>("bankingLaws")
    .findOne({ _id: countryId }, { projection: { depositCorridor: 1, lendingCorridor: 1 } });

  if (law?.depositCorridor && law?.lendingCorridor) {
    return { deposit: law.depositCorridor, lending: law.lendingCorridor };
  }

  const eraUnitScale = await loadWorldEraUnitScale(db);
  const historical = isHistoricalEra(eraUnitScale);
  return {
    deposit:
      law?.depositCorridor ?? (historical ? HISTORICAL_DEPOSIT_CORRIDOR : MODERN_DEPOSIT_CORRIDOR),
    lending:
      law?.lendingCorridor ?? (historical ? HISTORICAL_LENDING_CORRIDOR : MODERN_LENDING_CORRIDOR),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Silently correct charter offsets into the given corridors.
 * Used for repair/display; {@link setBankRates} rejects out-of-band values instead.
 */
export function clampOffsets(
  charter: Pick<BankCharter, "depositOffset" | "lendingOffset">,
  corridors: RateCorridors
): { depositOffset: number; lendingOffset: number } {
  return {
    depositOffset: clamp(
      charter.depositOffset,
      corridors.deposit.minOffset,
      corridors.deposit.maxOffset
    ),
    lendingOffset: clamp(
      charter.lendingOffset,
      corridors.lending.minOffset,
      corridors.lending.maxOffset
    ),
  };
}

/** Whether an offset sits inside `[min, max]` (inclusive). */
export function isOffsetInCorridor(offset: number, corridor: RateCorridor): boolean {
  return Number.isFinite(offset) && offset >= corridor.minOffset && offset <= corridor.maxOffset;
}
