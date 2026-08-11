import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getGameState } from "@/lib/gameState";

/**
 * Central bank governance: who sets the policy rate.
 *
 * Historically the Bank of England had no operational independence — the
 * Chancellor set Bank Rate until May 1997, when the incoming government
 * handed rate-setting to the Bank and created the MPC. So a UK world whose
 * era START predates 1997 opens with the Treasury in control, and Parliament
 * can legislate independence (or a post-1997 world can legislate it away)
 * through a `central_bank_independence` bill provision.
 *
 * The default is keyed on the era START year, not the live year: a 1991
 * world that plays past 1997 does NOT flip automatically, because a transfer
 * of monetary power is a statute, and the calendar must never legislate on
 * the players' behalf (gravity, not rails). An explicit
 * `bank.governmentControlled` written by legislation always wins.
 */
export const BOE_INDEPENDENCE_YEAR = 1997;

/** Countries whose central bank the government controls before `BOE_INDEPENDENCE_YEAR`. */
const HISTORICALLY_GOVERNMENT_CONTROLLED: ReadonlySet<string> = new Set(["UK"]);

export function isBankGovernmentControlled(
  bank: Pick<CentralBank, "governmentControlled">,
  countryId: CountryId,
  startingYear: number | undefined
): boolean {
  if (typeof bank.governmentControlled === "boolean") return bank.governmentControlled;
  return (
    HISTORICALLY_GOVERNMENT_CONTROLLED.has(countryId) &&
    typeof startingYear === "number" &&
    startingYear < BOE_INDEPENDENCE_YEAR
  );
}

/** Era start year for the running world, matching the SCOTUS turn's resolution. */
export async function resolveWorldStartingYear(): Promise<number | undefined> {
  const gameState = await getGameState();
  return (
    gameState?.startingYear ?? getStartingYearForPreset(gameState?.preset ?? DEFAULT_SEED_PRESET)
  );
}

/**
 * True when a national parliament can legislate this bank's independence at
 * all. Countries on a shared bank are out: an ECB member's legislature cannot
 * rewrite a treaty institution, and a sterlingized SCO/WAL cannot legislate
 * over the Bank of England — that is Westminster's call. `sharedBankId`
 * catches both cases; the bank's home country (UK itself) does not carry it.
 */
export function canLegislateBankIndependence(countryId: CountryId): boolean {
  return !COUNTRY_CONFIGS[countryId]?.centralBank.sharedBankId;
}

export async function isBankGovernmentControlledLive(
  bank: Pick<CentralBank, "governmentControlled">,
  countryId: CountryId
): Promise<boolean> {
  const startingYear = await resolveWorldStartingYear();
  return isBankGovernmentControlled(bank, countryId, startingYear);
}
