"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { formatFundsCompact, formatCompactNumber } from "@/lib/utils/formatters";
import { formatVotes } from "./ElectionDetailHelpers";
import type { CandidateDetail } from "./ElectionDetailTypes";
import { CsInfoIcon } from "./CsInfoIcon";

interface PresidentialCandidateTableProps {
  sorted: CandidateDetail[];
  colorMap: Map<string, string>;
  tally: {
    totalVotes: Record<string, number>;
    turnSnapshots: { turn: number }[];
  };
  grandTotal: number;
  totalVotesCast: number;
  isEnded: boolean;
  electoralVotes: Record<string, number> | undefined;
  /** Seated president (may differ from EV leader after contingent resolution). */
  winnerCandidateId?: string | null;
  canEndorse: boolean | null | undefined;
  endorsedCandidateId: string | null;
  endorsing: boolean;
  onEndorse: (electionCandidateId: string) => void;
  canSupport: boolean | null | undefined;
  supporting: boolean;
  onSupport: (campaignId: string) => void;
  campaignStrengthOverrides?: Record<string, number>;
  /**
   * Whether to render the CS (campaign strength) column. Only the
   * presidential engine consumes campaignStrength, so the column is
   * suppressed for down-ballot races where the number has no vote effect.
   */
  showCampaignStrength?: boolean;
}

export function PresidentialCandidateTable({
  sorted,
  colorMap,
  tally,
  grandTotal,
  totalVotesCast,
  isEnded,
  electoralVotes,
  winnerCandidateId = null,
  canEndorse,
  endorsedCandidateId,
  endorsing,
  onEndorse,
  canSupport,
  supporting,
  onSupport,
  campaignStrengthOverrides,
  showCampaignStrength = true,
}: PresidentialCandidateTableProps) {
  const hasTurns = tally.turnSnapshots.length > 0;

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div
        className={`px-4 py-2 sm:px-5 sm:py-2.5 flex items-center justify-between text-xs font-medium ${
          isEnded
            ? "bg-green-500/10 border-b border-green-500/20 text-green-400"
            : "bg-blue-500/10 border-b border-blue-500/20 text-blue-400"
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isEnded ? "bg-green-400" : "bg-blue-400 animate-pulse"
            }`}
          />
          {isEnded ? "Final Results" : "Live Tally"}
        </span>
        {hasTurns && (
          <span className="text-muted font-normal">
            {formatVotes(totalVotesCast)} votes · {tally.turnSnapshots.length} turn
            {tally.turnSnapshots.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm lg:min-w-[720px]">
          <thead>
            <tr className="border-b border-card-border bg-background text-left text-xs font-medium uppercase tracking-wider text-muted">
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Candidate</th>
              <th className="hidden px-3 py-3 lg:table-cell">Running Mate</th>
              <th className="px-3 py-3 text-right">EV</th>
              <th className="px-3 py-3 text-right">Vote %</th>
              <th className="px-3 py-3 text-right">Votes</th>
              <th className="hidden px-3 py-3 text-right lg:table-cell">Fav</th>
              <th className="hidden px-3 py-3 text-right lg:table-cell">NPI</th>
              <th className="hidden px-3 py-3 text-right lg:table-cell">Cash</th>
              {showCampaignStrength && (
                <th className="hidden px-3 py-3 text-right lg:table-cell">CS</th>
              )}
              <th className="hidden px-3 py-3 text-center lg:table-cell">Endorsements</th>
              {canEndorse && <th className="px-3 py-3 text-center">Endorse</th>}
              {canSupport && <th className="px-3 py-3 text-center">Support</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {sorted.map((c, i) => {
              const votes = tally.totalVotes[c.id] ?? 0;
              const pct = (votes / grandTotal) * 100;
              const ev = electoralVotes?.[c.id] ?? 0;
              const color = colorMap.get(c.id)!;
              const href = c.isNPP ? `/politicians/npp/${c.nppId}` : `/character/${c.characterId}`;
              const isWinner =
                isEnded && (winnerCandidateId != null ? c.id === winnerCandidateId : i === 0);

              return (
                <tr
                  key={c.id}
                  className={`transition-colors ${
                    c.isYou ? "bg-primary/5" : "hover:bg-background/50"
                  }`}
                >
                  <td className="px-3 py-3">
                    <span
                      className={`tabular-nums font-medium ${i === 0 ? "text-yellow-400" : "text-muted"}`}
                    >
                      {i + 1}
                    </span>
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar url={c.avatarUrl} name={c.characterName} size="h-6 w-6" />
                      <div className="min-w-0">
                        <Link
                          href={href}
                          className="font-semibold hover:text-primary transition-colors"
                        >
                          {c.characterName}
                        </Link>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs" style={{ color }}>
                            {c.partyName}
                          </span>
                          {c.isYou && (
                            <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                              You
                            </span>
                          )}
                          {isWinner && (
                            <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">
                              Winner
                            </span>
                          )}
                          {c.isNPP && (
                            <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
                              NPP
                            </span>
                          )}
                          {c.campaignSuspended && (
                            <span
                              className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning"
                              title={
                                c.endorsementTargetWithdrawn
                                  ? "Endorsement target withdrew — transfers stopped"
                                  : c.endorsedCandidateName
                                    ? `Suspended — endorsing ${c.endorsedCandidateName}`
                                    : "Campaign suspended"
                              }
                            >
                              {c.endorsementTargetWithdrawn
                                ? "Suspended"
                                : c.endorsedCandidateName
                                  ? `Endorses ${c.endorsedCandidateName}`
                                  : "Suspended"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="hidden px-3 py-3 text-xs text-muted lg:table-cell">
                    {c.runningMateName ?? "—"}
                  </td>

                  <td className="px-3 py-3 text-right">
                    <span className="font-bold tabular-nums text-lg" style={{ color }}>
                      {ev}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-right">
                    <span className="font-semibold tabular-nums" style={{ color }}>
                      {pct.toFixed(1)}%
                    </span>
                  </td>

                  <td className="px-3 py-3 text-right tabular-nums text-muted text-xs">
                    {formatVotes(votes)}
                  </td>

                  <td className="hidden px-3 py-3 text-right lg:table-cell">
                    <span className="font-semibold tabular-nums text-xs text-yellow-400">
                      {c.favorability.toFixed(0)}%
                    </span>
                  </td>

                  <td className="hidden px-3 py-3 text-right lg:table-cell">
                    <span className="font-semibold tabular-nums text-xs text-blue-400">
                      {formatCompactNumber(c.nationalInfluence)}
                    </span>
                  </td>

                  <td className="hidden px-3 py-3 text-right lg:table-cell">
                    {c.campaignFunds != null ? (
                      c.campaignId ? (
                        <Link
                          href={`/campaign/${c.campaignId}`}
                          className="font-mono font-semibold tabular-nums text-xs text-amber-400 hover:text-amber-300 transition-colors"
                        >
                          {formatFundsCompact(c.campaignFunds)}
                        </Link>
                      ) : (
                        <span className="font-mono font-semibold tabular-nums text-xs text-amber-400">
                          {formatFundsCompact(c.campaignFunds)}
                        </span>
                      )
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>

                  {showCampaignStrength && (
                    <td className="hidden px-3 py-3 text-right lg:table-cell">
                      <span className="tabular-nums text-xs text-primary font-medium inline-flex items-center gap-1">
                        {(() => {
                          const cs =
                            c.campaignId != null &&
                            campaignStrengthOverrides?.[c.campaignId] != null
                              ? campaignStrengthOverrides[c.campaignId]
                              : c.campaignStrength;
                          return cs != null ? (
                            <>
                              {formatCompactNumber(cs).toLowerCase()}{" "}
                              <CsInfoIcon campaignId={c.campaignId} />
                            </>
                          ) : (
                            "—"
                          );
                        })()}
                      </span>
                    </td>
                  )}

                  <td className="hidden px-3 py-3 text-center lg:table-cell">
                    {c.endorsements.length > 0 ? (
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-semibold text-xs text-yellow-400">
                          {c.endorsements.length}
                        </span>
                        <svg
                          className="h-3 w-3 text-yellow-400"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      </div>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>

                  {canEndorse && (
                    <td className="px-3 py-3 text-center">
                      {c.isYou ? (
                        <span className="text-muted text-xs">—</span>
                      ) : (
                        <button
                          onClick={() => onEndorse(c.id)}
                          disabled={endorsing}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            endorsedCandidateId === c.id
                              ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/40"
                              : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 hover:border-primary/50"
                          } disabled:opacity-50`}
                        >
                          {endorsedCandidateId === c.id ? "Endorsed" : "Endorse"}
                        </button>
                      )}
                    </td>
                  )}

                  {canSupport && (
                    <td className="px-3 py-3 text-center">
                      {c.campaignId ? (
                        <button
                          onClick={() => onSupport(c.campaignId!)}
                          disabled={supporting}
                          className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 hover:border-primary/50 disabled:opacity-50"
                        >
                          Support
                        </button>
                      ) : (
                        <span className="text-muted text-xs">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Endorsements expansion */}
      {sorted.some((c) => c.endorsements.length > 0) && (
        <div className="border-t border-card-border p-4 bg-background/30">
          <div className="text-xs font-medium text-muted mb-3">Endorsements</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {sorted
              .filter((c) => c.endorsements.length > 0)
              .map((c) => {
                const nppCount = c.endorsements.filter((e) => e.type === "npp").length;
                const playerCount = c.endorsements.filter((e) => e.type === "player").length;
                const summary = [
                  nppCount > 0 ? `${nppCount} NPP` : null,
                  playerCount > 0 ? `${playerCount} player` : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <div key={c.id} className="text-xs">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-semibold" style={{ color: colorMap.get(c.id)! }}>
                        {c.characterName}
                      </span>
                      <span className="text-muted opacity-60">· {summary}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {c.endorsements.map((e, i) => (
                        <span
                          key={e.type === "npp" ? e.nppId : (e.characterId ?? `player-${i}`)}
                          className="flex items-center gap-0.5"
                        >
                          {e.type === "npp" ? (
                            <Link
                              href={`/politicians/npp/${e.nppId}`}
                              className="text-yellow-400 hover:text-yellow-300"
                            >
                              {e.nppName}
                            </Link>
                          ) : e.characterId ? (
                            <Link
                              href={`/character/${e.characterId}`}
                              className="text-blue-400 hover:text-blue-300"
                            >
                              {e.characterName}
                            </Link>
                          ) : (
                            <span className="text-blue-400">{e.characterName}</span>
                          )}
                          <span
                            className={`text-[9px] px-1 rounded ${
                              e.type === "npp"
                                ? "text-yellow-600 bg-yellow-500/10"
                                : "text-blue-600 bg-blue-500/10"
                            }`}
                          >
                            {e.type === "npp" ? "NPP" : "player"}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
