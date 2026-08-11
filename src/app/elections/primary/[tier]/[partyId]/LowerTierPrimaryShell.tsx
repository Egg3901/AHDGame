"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { TierSelector, type RaceTier } from "@/components/elections/primary/TierSelector";
import { PrimaryElectoralMap, type PrimaryStateData } from "@/components/PrimaryElectoralMap";
import { tierPrimaryRoute } from "@/lib/urls";

interface CandidateRow {
  candidateId: string;
  candidateName: string;
  votes: number;
  /**
   * Live vote share if the primary has votes cast, otherwise the
   * projected share (primaryScore / partyTotal × 100) — same number the
   * state primary detail page surfaces on its per-candidate progress bars.
   */
  sharePct: number;
  color: string;
  isNPP: boolean;
  characterId: string | null;
  nppId: string | null;
}

interface StateContestSummary {
  stateId: string;
  electionId: string;
  hasResults: boolean;
  totalSeats: number;
  candidates: CandidateRow[];
}

interface StateLeaderRow {
  stateId: string;
  leader: CandidateRow | null;
  totalVotes: number;
  hasResults: boolean;
  totalSeats: number;
}

/**
 * Shared shell for the lower-tier (Senate / Governor / House) per-party
 * primary aggregator pages. Renders the TierSelector across the top, a
 * national state map colored by leading candidate, and a side panel that
 * shows the selected state's contest details.
 *
 * The shell is intentionally agnostic to the specific tier — pages pass
 * pre-computed candidate colors + per-state data + an optional
 * district-detail slot (used by House) so the same chrome carries every
 * lower-tier surface.
 */
export function LowerTierPrimaryShell({
  tier,
  partyId,
  partyColor,
  countryId,
  stateMapData,
  contestsByState,
  selectedStateId,
  stateLeaderRows,
  emptyMessage,
  districtSlot,
}: {
  tier: RaceTier;
  partyId: string;
  partyColor?: string;
  countryId: string;
  /** Per-state fill data ready for `PrimaryElectoralMap`. */
  stateMapData: Record<string, PrimaryStateData>;
  /** Map state -> contest summary (candidates + seats). Used by the side panel. */
  contestsByState: Record<string, StateContestSummary>;
  /** Currently selected state — drives the side panel. */
  selectedStateId: string | null;
  /**
   * One row per state with an active contest, showing the state's current
   * primary leader. Replaces the old tier-wide vote aggregate (which
   * mixed candidates from independent state races into a single
   * "standings" list that was hard to read and not actually comparable
   * since each candidate only runs in their own state).
   */
  stateLeaderRows: StateLeaderRow[];
  /** Copy for the side panel when no contest is selected. */
  emptyMessage: string;
  /**
   * Optional slot rendered inside the side panel after the contest summary.
   * The House page uses this to inject a district-resolution drilldown.
   */
  districtSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onSelectState = useCallback(
    (stateId: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("state", stateId);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const onTierChange = useCallback(
    (next: RaceTier) => {
      if (next === tier) return;
      router.push(tierPrimaryRoute(next, partyId));
    },
    [router, partyId, tier]
  );

  const selectedContest = selectedStateId ? contestsByState[selectedStateId] : null;

  const totalActiveContests = useMemo(() => Object.keys(contestsByState).length, [contestsByState]);

  return (
    <div className="space-y-4">
      <TierSelector
        countryId={countryId}
        activeTier={tier}
        partyColor={partyColor}
        onTierChange={onTierChange}
      />

      <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-xl border border-card-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              {tier === "senate"
                ? "Senate primaries"
                : tier === "stateSenate"
                  ? "State Senate primaries"
                  : tier === "governor"
                    ? "Gubernatorial primaries"
                    : "House primaries"}
            </h2>
            <span className="text-[10px] uppercase tracking-wider text-muted">
              {totalActiveContests} active
            </span>
          </div>
          <PrimaryElectoralMap stateData={stateMapData} onStateClick={onSelectState} />
        </div>

        <div className="rounded-xl border border-card-border bg-card p-4">
          {selectedContest ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  {selectedContest.stateId}{" "}
                  <span className="text-xs font-normal text-muted">
                    ({selectedContest.totalSeats} seat
                    {selectedContest.totalSeats === 1 ? "" : "s"})
                  </span>
                </h3>
                <span className="text-[10px] uppercase tracking-wider text-muted">
                  {selectedContest.hasResults ? "Live tally" : "No votes yet"}
                </span>
              </div>
              {selectedContest.candidates.length === 0 ? (
                <p className="text-xs text-muted">No party candidates filed in this state yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {selectedContest.candidates.map((c) => (
                    <li
                      key={c.candidateId}
                      className="flex items-center justify-between gap-3 rounded-md border border-card-border/40 bg-background/40 px-2.5 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                        <span className="truncate font-medium text-foreground">
                          {c.candidateName}
                        </span>
                        {c.isNPP && (
                          <span className="rounded bg-purple-500/20 px-1 py-0.5 text-[9px] uppercase tracking-wide text-purple-300">
                            NPP
                          </span>
                        )}
                      </div>
                      <span className="tabular-nums text-muted">
                        {c.sharePct.toFixed(1)}%
                        {selectedContest.hasResults && (
                          <span className="ml-1 text-[10px] opacity-70">
                            ({c.votes.toLocaleString("en-US")})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {districtSlot}
            </div>
          ) : (
            <p className="text-xs text-muted">{emptyMessage}</p>
          )}
        </div>
      </div>

      {stateLeaderRows.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-card-border bg-background text-xs font-medium uppercase tracking-wider text-muted">
            State-by-state leaders
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-background text-left text-xs font-medium uppercase tracking-wider text-muted">
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Leader</th>
                <th className="px-3 py-2 text-right">Seats</th>
                <th className="px-3 py-2 text-right">Share</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {stateLeaderRows.map((row) => (
                <tr
                  key={row.stateId}
                  className={
                    row.stateId === selectedStateId
                      ? "bg-[var(--card-muted)]/40 cursor-pointer"
                      : "cursor-pointer hover:bg-[var(--card-muted)]/30"
                  }
                  onClick={() => onSelectState(row.stateId)}
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.stateId}</td>
                  <td className="px-3 py-2">
                    {row.leader ? (
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: row.leader.color }}
                        />
                        <span className="font-medium">{row.leader.candidateName}</span>
                        {row.leader.isNPP && (
                          <span className="rounded bg-purple-500/20 px-1 py-0.5 text-[9px] uppercase tracking-wide text-purple-300">
                            NPP
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{row.totalSeats}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {row.leader ? `${row.leader.sharePct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted">
                    {row.hasResults ? "live" : "projected"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export type { CandidateRow, StateContestSummary, StateLeaderRow };
