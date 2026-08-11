"use client";

import { useMemo } from "react";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import {
  isElectionInPrimaryPhase,
  type CountrySelection,
  type ElectionData,
} from "./electionsAdminTypes";

interface ElectionBreakdownProps {
  elections: ElectionData[];
  selectedCountry: CountrySelection;
  currentTurn: number | null;
}

/** Map election type keys to display labels */
const TYPE_LABELS: Record<string, string> = {
  house: "House",
  senate: "Senate",
  governor: "Governor",
  stateSenate: "State Senate",
  president: "President",
  commons: "Commons",
  snap_commons: "Snap Commons",
  regionalCouncil: "Reg. Council",
  shugiin: "Shūgiin",
  sangiin: "Sangiin",
  snap_shugiin: "Snap Shūgiin",
};

function phaseCounts(list: ElectionData[], currentTurn: number | null) {
  let pri = 0;
  let gen = 0;
  for (const e of list) {
    if (e.status !== "active") continue;
    // Turn-first so the breakdown doesn't drift when the cron lags wall-clock.
    if (isElectionInPrimaryPhase(e, currentTurn)) pri++;
    else gen++;
  }
  return { pri, gen, total: pri + gen };
}

export function ElectionBreakdown({
  elections,
  selectedCountry,
  currentTurn,
}: ElectionBreakdownProps) {
  const isGlobal = selectedCountry === "global";

  const rows = useMemo(() => {
    const result: { label: string; countryId?: string; pri: number; gen: number; total: number }[] =
      [];

    if (isGlobal) {
      const byCountry = new Map<string, ElectionData[]>();
      for (const e of elections) {
        const cid = e.countryId ?? "US";
        if (!byCountry.has(cid)) byCountry.set(cid, []);
        byCountry.get(cid)!.push(e);
      }
      for (const [cid, list] of byCountry) {
        const cfg = COUNTRY_CONFIGS[cid as keyof typeof COUNTRY_CONFIGS];
        const counts = phaseCounts(list, currentTurn);
        result.push({
          label: cfg?.name ?? cid,
          countryId: cid,
          ...counts,
        });
      }
    } else {
      const byType = new Map<string, ElectionData[]>();
      for (const e of elections) {
        if (!byType.has(e.electionType)) byType.set(e.electionType, []);
        byType.get(e.electionType)!.push(e);
      }
      for (const [type, list] of byType) {
        const counts = phaseCounts(list, currentTurn);
        result.push({ label: TYPE_LABELS[type] ?? type, ...counts });
      }
    }

    return result.sort((a, b) => b.total - a.total);
  }, [elections, isGlobal, currentTurn]);

  return (
    <div className="rounded-lg border border-card-border bg-card p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
        {isGlobal ? "Elections by Country" : "Elections by Type"}
      </div>
      <div className="text-[11px]">
        <div className="grid grid-cols-[1fr_40px_40px_44px] gap-2 border-b border-card-border pb-1 text-[9px] font-semibold uppercase text-muted">
          <span />
          <span className="text-right">Pri</span>
          <span className="text-right">Gen</span>
          <span className="text-right">Total</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-[1fr_40px_40px_44px] gap-2 border-b border-card-border/50 py-1"
          >
            <span>
              {r.countryId && <CountryFlag country={r.countryId} size="sm" className="mr-1" />}
              {r.label}
            </span>
            <span className="text-right tabular-nums text-amber-500">
              {r.pri || <span className="text-muted">—</span>}
            </span>
            <span className="text-right tabular-nums text-green-500">
              {r.gen || <span className="text-muted">—</span>}
            </span>
            <span className="text-right tabular-nums font-semibold">
              {r.total || <span className="text-muted">—</span>}
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="py-2 text-center text-muted">No active elections</div>
        )}
      </div>
    </div>
  );
}
