/**
 * Character campaign-fund balance in LOCAL currency, for affordability checks.
 *
 * When forex is ON, this is `currencyBalances.campaign` — NEVER the legacy
 * anchor `funds` field. `funds` is USD-scaled; in a high-denomination currency
 * (e.g. NGN) it reads as a tiny local balance, so falling back to it when
 * `currencyBalances.campaign` is momentarily undefined produces a false
 * "insufficient funds" for forex players (tickets #885 / #888). When forex is
 * OFF, the legacy `funds` field is the balance.
 *
 * Callers already write deductions to the correct field
 * (`forexEnabled ? "currencyBalances.campaign" : "funds"`); this only fixes the
 * READ side used for the pre-check / displayed balance.
 */
export function localCampaignBalance(
  character: { currencyBalances?: { campaign?: number } | null; funds?: number },
  forexEnabled: boolean
): number {
  return forexEnabled ? (character.currencyBalances?.campaign ?? 0) : (character.funds ?? 0);
}
