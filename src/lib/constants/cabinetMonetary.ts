import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * Cabinet Monetary widget tunables. The Debt Management Operation accelerates
 * investor-confidence recovery for a bounded window, lowering the sovereign
 * confidence premium faster than the natural heal. All magnitudes are tunable
 * here in one place. Durations are in TURNS (24 turns/day) per project convention.
 */

/** Active window of a launched operation (≈ a quarter game-year). */
export const DEBT_OP_DURATION_TURNS = 12;

/**
 * Extra investor-confidence recovery applied each active turn (points/turn), on
 * top of the natural heal. Clamped at INVESTOR_CONFIDENCE_BASELINE by the turn
 * step — an op launched at/above baseline does nothing.
 */
export const DEBT_OP_CONFIDENCE_BOOST_PER_TURN = 1.0;

/** Turns after an operation expires before a new one may be launched. */
export const DEBT_OP_COOLDOWN_TURNS = 12;

/** The finance/treasury cabinet seat for a country, or null. */
export function resolveFinancePosition(countryId: string): string | null {
  return COUNTRY_CONFIGS[countryId as CountryId]?.financeMinisterCabinetId ?? null;
}
