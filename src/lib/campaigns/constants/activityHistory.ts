/**
 * How many activity entries a campaign keeps on `Campaign.activityHistory`.
 *
 * Every writer that pushes to the array MUST slice to this same number. Five
 * paths write it: upgrade purchases and opposition-research resets in
 * `campaignCommands.ts`, insolvency downgrades in `campaignTurn.ts`,
 * suspend-endorse in `suspendEndorse.ts`, and the backfill in
 * `scripts/migrations/autoDowngradeInsolventCampaigns.ts`. A writer using its
 * own literal silently truncates records the others kept, which is exactly what
 * the migration did while it sliced to its own 20.
 *
 * 200 is deep enough to be a campaign's whole life rather than a rolling
 * window. Strategic Operations caps total investment at `OPS_TOTAL_CAP` (40),
 * so purchase entries are structurally bounded; the remainder covers
 * downgrades, resets and suspend-endorse, which are the only entries that can
 * repeat.
 *
 * Depth is only affordable because no query that spans many campaigns carries
 * the array. Every multi-campaign read either names the fields it wants or
 * excludes this one: the hourly turn engine and presidential vote
 * accumulation, the fog-of-war sweep, the per-election campaign list, the
 * admin heal sweep, the campaign chooser page, and the nav lookup in
 * `getViewerCampaigns`. Only `getCampaignDetail` reads the array, for the one
 * campaign whose page is open.
 *
 * A new read that spans campaigns must keep that true, or it will carry twenty
 * times what it used to. Note that Mongo rejects mixing inclusion and exclusion
 * in one projection, so add `activityHistory: 0` only where the query does not
 * already list the fields it wants.
 */
export const CAMPAIGN_ACTIVITY_HISTORY_CAP = 200;
