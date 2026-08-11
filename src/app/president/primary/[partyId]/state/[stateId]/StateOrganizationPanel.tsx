"use client";

import { useEffect, useState } from "react";
import { MAX_STATE_ORG_BONUS_PRIMARY, STATE_ORG_MAX_LEVEL } from "@/lib/electionEngine/constants";

interface CandidateRow {
  characterId: string;
  characterName: string;
  level: number;
}

export function StateOrganizationPanel({ stateId }: { stateId: string }) {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/political-operations/state-org/by-state/${stateId}`)
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((d: { candidates?: CandidateRow[] }) => {
        setCandidates(d.candidates ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [stateId]);

  if (!loaded || candidates.length === 0) return null;
  return (
    <section className="mb-6 rounded-xl border border-card-border bg-card p-4">
      <h3 className="text-sm font-semibold">Organization in {stateId}</h3>
      <p className="mb-2 text-xs text-muted">
        Per-candidate ground game investment. Each level multiplies the candidate&apos;s primary
        weight in this state (+{Math.round(MAX_STATE_ORG_BONUS_PRIMARY * 100)}% at level{" "}
        {STATE_ORG_MAX_LEVEL}).
      </p>
      <ul className="space-y-1 text-sm">
        {candidates.map((c) => {
          const filled = "▓".repeat(c.level);
          const empty = "░".repeat(STATE_ORG_MAX_LEVEL - c.level);
          const pct = Math.round(
            (c.level / STATE_ORG_MAX_LEVEL) * MAX_STATE_ORG_BONUS_PRIMARY * 100
          );
          return (
            <li key={c.characterId} className="flex items-center justify-between">
              <span className="text-foreground">{c.characterName}</span>
              <span className="font-mono text-xs text-muted">
                {filled}
                {empty} Lv {c.level} · +{pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
