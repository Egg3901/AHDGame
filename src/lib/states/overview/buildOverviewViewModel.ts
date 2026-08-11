/**
 * Pure view-model builder for the State Overview tab (Phase 1).
 *
 * Takes a `StateOverviewResult` (server-fetched) plus the viewing user's
 * `partyId` and decorates the result with presentation-derived fields:
 *   - pie focus selection (viewer's party if they have one in this state,
 *     else the leading party)
 *   - focus-party color + abbreviation surfaced once for cheap reads
 *   - narrative summary (rank, total parties, gap to leader) for the
 *     Political Summary card
 *
 * Pure: no DB, no I/O; safe to call inside a server component or a client
 * component that received the `StateOverviewResult` via props.
 *
 * See plan §"Phase 1 — Task 1.3".
 */

import type { OverviewViewModel, StateOverviewResult, NarrativeSummary } from "./types";

const NEUTRAL_COLOR = "#6b6b7a";

interface BuildArgs {
  /** Stringified PoliticalParty._id of the viewing user, or null if unaffiliated. */
  viewerPartyId: string | null;
}

export function buildOverviewViewModel(
  result: StateOverviewResult,
  args: BuildArgs
): OverviewViewModel {
  const { partyOrg } = result;

  // Resolve the focus party: viewer's party if they have a row here,
  // otherwise the leading party. If no rows exist, focus is empty.
  const viewerRow =
    args.viewerPartyId != null ? partyOrg.find((row) => row.id === args.viewerPartyId) : undefined;
  const focusRow = viewerRow ?? partyOrg[0];

  const pieFocusPartyId = focusRow?.id ?? "";
  const focusPartyColor = focusRow?.color ?? NEUTRAL_COLOR;
  const focusPartyAbbr = focusRow?.abbr ?? "";
  const focusPartyOrgPct = focusRow?.orgPct ?? 0;

  // Narrative: rank of the focus party (1-indexed) within partyOrg, total
  // count, and Org gap to the leader.
  const narrative: NarrativeSummary = focusRow
    ? {
        rank: partyOrg.findIndex((r) => r.id === focusRow.id) + 1,
        totalParties: partyOrg.length,
        gapToTop: Math.max(0, (partyOrg[0]?.orgPct ?? 0) - focusRow.orgPct),
      }
    : { rank: 0, totalParties: partyOrg.length, gapToTop: 0 };

  return {
    ...result,
    pieFocusPartyId,
    focusPartyColor,
    focusPartyAbbr,
    focusPartyOrgPct,
    narrative,
  };
}
