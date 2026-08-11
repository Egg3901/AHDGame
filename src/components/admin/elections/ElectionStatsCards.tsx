"use client";

import { useMemo } from "react";
import { isElectionInPrimaryPhase, type ElectionData } from "./electionsAdminTypes";

interface ElectionStatsCardsProps {
  elections: ElectionData[];
  currentTurn: number | null;
}

export function ElectionStatsCards({ elections, currentTurn }: ElectionStatsCardsProps) {
  const { inPrimary, inGeneral, totalCandidates, active, primaryPct, generalPct, avgCandidates } =
    useMemo(() => {
      let pri = 0;
      let gen = 0;
      let cands = 0;

      for (const e of elections) {
        if (e.status !== "active") continue;
        // Turn-first phase classification so counts don't drift when the cron
        // lags behind wall-clock.
        if (isElectionInPrimaryPhase(e, currentTurn)) {
          pri++;
        } else {
          gen++;
        }
        cands += e.candidateCount;
      }

      const act = pri + gen;
      return {
        inPrimary: pri,
        inGeneral: gen,
        totalCandidates: cands,
        active: act,
        primaryPct: act > 0 ? Math.round((pri / act) * 100) : 0,
        generalPct: act > 0 ? 100 - Math.round((pri / act) * 100) : 0,
        avgCandidates: act > 0 ? (cands / act).toFixed(1) : "0",
      };
    }, [elections, currentTurn]);

  const cards = [
    {
      label: "Active Elections",
      value: active.toLocaleString("en-US"),
      sub: `${elections.length} total`,
      color: "text-foreground",
    },
    {
      label: "In Primary Phase",
      value: inPrimary.toLocaleString("en-US"),
      sub: `${primaryPct}% of active`,
      color: "text-amber-500",
    },
    {
      label: "In General Phase",
      value: inGeneral.toLocaleString("en-US"),
      sub: `${generalPct}% of active`,
      color: "text-green-500",
    },
    {
      label: "Total Candidates",
      value: totalCandidates.toLocaleString("en-US"),
      sub: `avg ${avgCandidates} per race`,
      color: "text-foreground",
    },
  ];

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-card-border bg-card p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
            {c.label}
          </div>
          <div className={`mt-1 text-xl font-bold tabular-nums ${c.color}`}>{c.value}</div>
          <div className="mt-0.5 text-[10px] text-muted">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
