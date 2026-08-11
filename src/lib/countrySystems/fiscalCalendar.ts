import { COUNTRY_ORDER, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

export interface FiscalCalendarConfig {
  /** Turn in the 48-turn year when the next fiscal year begins. */
  startTurnInYear: number;
}

export function getFiscalCalendarConfig(countryId: CountryId): FiscalCalendarConfig {
  const config = getCountryConfig(countryId);
  return {
    startTurnInYear: config.fiscalYearStartTurnInYear,
  };
}

export function getTurnInYear(currentTurn: number): number {
  return ((currentTurn - 1) % TURNS_PER_YEAR) + 1;
}

export function isFiscalYearEndForCountry(countryId: CountryId, currentTurn: number): boolean {
  return getTurnInYear(currentTurn) === getFiscalCalendarConfig(countryId).startTurnInYear;
}

export function calculateFiscalYearForCountry(
  countryId: CountryId,
  currentYear: number,
  currentTurn: number
): number {
  const turnInYear = getTurnInYear(currentTurn);
  return turnInYear >= getFiscalCalendarConfig(countryId).startTurnInYear
    ? currentYear + 1
    : currentYear;
}

export function getSharedFiscalYearStartTurnInYear(
  countryIds: CountryId[] = COUNTRY_ORDER
): number {
  const [firstCountryId, ...restCountryIds] = countryIds;
  if (!firstCountryId) {
    throw new Error("Cannot resolve a shared fiscal calendar without at least one country.");
  }

  const sharedStartTurn = getFiscalCalendarConfig(firstCountryId).startTurnInYear;
  const mismatch = restCountryIds.find(
    (countryId) => getFiscalCalendarConfig(countryId).startTurnInYear !== sharedStartTurn
  );

  if (mismatch) {
    throw new Error(
      `Shared fiscal-year helpers cannot assume a single calendar once ${mismatch} diverges.`
    );
  }

  return sharedStartTurn;
}
