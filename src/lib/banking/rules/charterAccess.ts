/**
 * Player investment banks are available in fresh 1991 worlds with forex fees.
 * bankingSeparationDefault preserves the US retail/investment choice before
 * 1999; enacted banking laws still override that default.
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { resolveGameYear } from "@/lib/era/era";

export function bankingWorldYear(
  state: {
    currentYear?: number;
    startingYear?: number;
    currentTurn?: number;
    preset?: string;
  } | null
): number | null {
  if (!state) return null;
  const live = resolveGameYear(state);
  if (live !== null) return live;
  const presetYear = /^(\d{4})-default$/.exec(state.preset ?? "");
  if (!presetYear) return null;
  const elapsed = Number.isFinite(state.currentTurn)
    ? Math.floor(Math.max(0, (state.currentTurn ?? 1) - 1) / TURNS_PER_YEAR)
    : 0;
  return Number(presetYear[1]) + elapsed;
}

export function bankingSeparationDefault(input: {
  countryId: string;
  year: number | null;
  eraUnitScale: number;
}): "separated" | "universal" {
  if (input.countryId === "US" && input.year !== null && Number.isFinite(input.year))
    return input.year < 1999 ? "separated" : "universal";
  return input.eraUnitScale > 1 ? "separated" : "universal";
}

export function playerInvestmentBankingSeedFlags(seedYear: number) {
  return seedYear === 1991
    ? {
        privateBankingEnabled: true,
        bankPropTradingEnabled: true,
        playerAdvancedBankChartersEnabled: true,
        bankPropForexFeesEnabled: true,
      }
    : {};
}
