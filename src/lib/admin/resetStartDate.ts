import { TURNS_PER_YEAR, getStartingYearForPreset } from "@/lib/constants/turnTime";

export const RESET_DATE_MIN_YEAR = 1953;
export const RESET_DATE_MAX_YEAR = 2027;

export interface ResetStartDate {
  year: number;
  /** Game-calendar week. A game year contains 48 turns/weeks. */
  week: number;
}

export interface ResolvedResetStartDate extends ResetStartDate {
  startingYear: number;
  currentTurn: number;
  currentYear: number;
}

/** Resolve an exact reset date without breaking preset-relative election anchors. */
export function resolveResetStartDate(
  preset: string,
  requested?: ResetStartDate
): ResolvedResetStartDate {
  const startingYear = getStartingYearForPreset(preset);
  const date = requested ?? { year: startingYear, week: 1 };

  if (
    !Number.isInteger(date.year) ||
    date.year < RESET_DATE_MIN_YEAR ||
    date.year > RESET_DATE_MAX_YEAR
  ) {
    throw new Error(
      `Reset year must be an integer from ${RESET_DATE_MIN_YEAR} through ${RESET_DATE_MAX_YEAR}`
    );
  }
  if (!Number.isInteger(date.week) || date.week < 1 || date.week > TURNS_PER_YEAR) {
    throw new Error(`Reset week must be an integer from 1 through ${TURNS_PER_YEAR}`);
  }
  if (date.year < startingYear) {
    throw new Error(
      `Reset date ${date.year} week ${date.week} cannot precede the ${startingYear} preset anchor`
    );
  }

  return {
    ...date,
    startingYear,
    currentTurn: (date.year - startingYear) * TURNS_PER_YEAR + date.week,
    currentYear: date.year,
  };
}

export function isPresetAnchorDate(preset: string, date?: ResetStartDate): boolean {
  if (!date) return true;
  return date.year === getStartingYearForPreset(preset) && date.week === 1;
}
