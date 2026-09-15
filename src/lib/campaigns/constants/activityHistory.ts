/**
 * How many activity entries a campaign keeps on `Campaign.activityHistory`.
 *
 * Every writer that pushes to the array MUST slice to this same number. Four
 * paths write it (upgrade purchases and opposition-research resets in
 * `campaignCommands.ts`, insolvency downgrades in `campaignTurn.ts`, and
 * suspend-endorse in `suspendEndorse.ts`), and a writer using its own literal
 * would silently truncate records the other three had kept.
 *
 * 200 is deep enough to be a campaign's whole life rather than a rolling
 * window. Strategic Operations caps total investment at `OPS_TOTAL_CAP` (40),
 * so purchase entries are structurally bounded; the remainder covers
 * downgrades, resets and suspend-endorse, which are the only entries that can
 * repeat. The array is excluded from the turn engine's campaign read, so
 * depth here costs the hourly turn nothing.
 */
export const CAMPAIGN_ACTIVITY_HISTORY_CAP = 200;
