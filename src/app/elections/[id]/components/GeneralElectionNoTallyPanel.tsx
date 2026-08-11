"use client";

import Link from "next/link";
import { useState, useCallback } from "react";
import { Avatar } from "@/components/Avatar";
import { PieChart } from "./ElectionDetailCharts";
import { buildGeneralColors } from "@/lib/utils/politics";
import type { CandidateDetail } from "./ElectionDetailTypes";

export function GeneralElectionNoTallyPanel({
  candidates,
  totalSeats,
  electionId,
  electionType,
  myCharId,
  myEndorsedCandidateId: initialEndorsedId,
}: {
  candidates: CandidateDetail[];
  isEnded: boolean;
  totalSeats: number | null;
  electionId?: string;
  electionType?: string;
  myCharId?: string | null;
  myEndorsedCandidateId?: string | null;
}) {
  const [endorsedCandidateId, setEndorsedCandidateId] = useState<string | null>(
    initialEndorsedId ?? null
  );
  const [endorsing, setEndorsing] = useState(false);

  const isPresident = electionType === "president";
  const canEndorse = isPresident && myCharId;

  const handleEndorse = useCallback(
    async (electionCandidateId: string) => {
      if (!electionId || endorsing) return;
      // endorsedCandidateId and electionCandidateId are both electionCandidates row ids.
      const isWithdraw = endorsedCandidateId === electionCandidateId;
      setEndorsing(true);
      try {
        if (isWithdraw) {
          const res = await fetch(`/api/elections/${electionId}/endorse`, { method: "DELETE" });
          if (res.ok) setEndorsedCandidateId(null);
        } else {
          const res = await fetch(`/api/elections/${electionId}/endorse`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidateId: electionCandidateId }),
          });
          if (res.ok) {
            const data = await res.json();
            setEndorsedCandidateId(data.endorsement.candidateId);
          }
        }
      } catch {
        // silent
      } finally {
        setEndorsing(false);
      }
    },
    [electionId, endorsedCandidateId, endorsing]
  );
  const sorted = [...candidates].sort((a, b) => b.primaryScore - a.primaryScore);
  const colorMap = buildGeneralColors(sorted);

  const pieSlices = sorted.map((c) => ({
    label: c.characterName,
    pct: 100 / sorted.length,
    color: colorMap.get(c.id)!,
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-4 py-2 sm:px-5 sm:py-2.5 flex items-center justify-between text-xs font-medium bg-info/10 border-b border-info/20 text-info">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
            General Election — Awaiting First Turn
          </span>
          <span className="text-muted font-normal">Vote counting begins next turn</span>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex gap-4 sm:gap-6">
            <div className="shrink-0 flex flex-col items-center">
              <PieChart slices={pieSlices} size={120} />
            </div>
            <div className="flex-1 min-w-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-muted border-b border-card-border">
                    <th className="pb-1.5 font-medium">Candidate</th>
                    <th className="pb-1.5 font-medium text-right w-20">Votes</th>
                    <th className="pb-1.5 font-medium text-right w-14">%</th>
                    {canEndorse && <th className="pb-1.5 w-20" />}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => {
                    const color = colorMap.get(c.id)!;
                    const href = c.isNPP
                      ? `/politicians/npp/${c.nppId}`
                      : `/character/${c.characterId}`;
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-card-border/40 last:border-0 ${c.isYou ? "bg-primary/5" : ""}`}
                      >
                        <td className="py-2.5 pr-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <Avatar url={c.avatarUrl} name={c.characterName} size="h-5 w-5" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <Link
                                  href={href}
                                  className="font-semibold hover:text-primary transition-colors truncate"
                                >
                                  {c.characterName}
                                </Link>
                                {c.isYou && (
                                  <span className="rounded-full bg-primary/20 border border-primary/40 px-1.5 py-0.5 text-[10px] text-primary shrink-0">
                                    You
                                  </span>
                                )}
                                {c.isNPP && (
                                  <span className="rounded-full bg-purple-500/20 border border-purple-500/40 px-1.5 py-0.5 text-[10px] text-purple-400 shrink-0">
                                    NPP
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-muted">{c.partyName}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 text-right text-xs text-muted">—</td>
                        <td className="py-2.5 pl-1 text-right text-xs text-muted">—</td>
                        {canEndorse && (
                          <td className="py-2.5 pl-1 text-right">
                            {!c.isYou && (
                              <button
                                onClick={() => handleEndorse(c.id)}
                                disabled={endorsing}
                                className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                  endorsedCandidateId === c.id
                                    ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40"
                                    : "bg-primary/10 text-primary border border-primary/30"
                                } disabled:opacity-50`}
                              >
                                {endorsedCandidateId === c.id ? "Endorsed" : "Endorse"}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {totalSeats && (
        <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
          <div className="text-sm font-semibold mb-1">
            Seats Up for Election · {totalSeats} total
          </div>
          <p className="text-xs text-muted">
            Projected seat allocation will appear once vote counting begins. Seats are awarded
            proportionally to vote share.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-dashed border-card-border p-4 sm:p-5 text-center text-sm text-muted">
        Vote totals and the trend graph will appear once the next game turn processes.
      </div>
    </div>
  );
}
