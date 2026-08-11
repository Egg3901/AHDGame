/**
 * Syncs character stats (actions, funds) to the StatusBar footer without a full page refresh.
 * Call this when an action completes and the character has been updated server-side.
 */
export const CHARACTER_STATS_UPDATED = "character-stats-updated";

/**
 * Lightweight signal used by mutating UI flows (bond/share trades, forex, savings,
 * transfers) that don't have the new character state in hand. The StatusBar
 * listens and refetches /api/client-status. Use this when you'd otherwise leave
 * the chip stale because the API response doesn't echo the player's wallet.
 */
export const CHARACTER_STATS_REFETCH = "character-stats-refetch";

export function notifyCharacterStatsUpdated(character: {
  actions?: number;
  funds?: number;
  campaignFundsStored?: number;
  cashOnHand?: number;
  personalHomeLiquid?: number;
}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CHARACTER_STATS_UPDATED, {
      detail: {
        actions: character.actions ?? 0,
        funds: character.funds ?? 0,
        cashOnHand: character.cashOnHand ?? 0,
        campaignFundsStored: character.campaignFundsStored,
        personalHomeLiquid: character.personalHomeLiquid,
      },
    })
  );
}

export function requestCharacterStatsRefetch() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHARACTER_STATS_REFETCH));
}
