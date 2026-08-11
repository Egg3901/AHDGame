"use client";

// RecentActionsPanel — a mini audit stream scoped to this account: the last
// N `actionAuditLog` envelopes the user authored, plus a "Flagged" filter
// that swaps in the anomaly-flagged subset. Rendering reuses the Forensics
// explorer's vocabulary (category dot, one-line summary, flag chips) so a
// row here looks exactly like the same row in the full Audit Explorer.

import { useState } from "react";
import { FlagChips } from "@/components/admin/forensics/FlagChips";
import {
  categoryMeta,
  formatRelative,
  formatTimestamp,
  summarizeRecord,
  type ActionAuditRecord,
} from "@/components/admin/forensics/types";
import { OVERLINE_CLS, PANEL_CLS } from "./dossierTypes";

interface RecentActionsPanelProps {
  recentActions: ActionAuditRecord[];
  flaggedActions: ActionAuditRecord[];
}

type StreamMode = "all" | "flagged";

export function RecentActionsPanel({ recentActions, flaggedActions }: RecentActionsPanelProps) {
  const [mode, setMode] = useState<StreamMode>("all");
  const rows = mode === "all" ? recentActions : flaggedActions;

  return (
    <section className={PANEL_CLS} aria-label="Recent actions">
      <div className="mb-2 flex items-center gap-2">
        <h3 className={OVERLINE_CLS}>Recent actions</h3>
        <div
          className="ml-auto inline-flex overflow-hidden rounded-lg border border-card-border"
          role="group"
          aria-label="Action stream filter"
        >
          <StreamButton
            active={mode === "all"}
            onClick={() => setMode("all")}
            label={`All (${recentActions.length})`}
          />
          <StreamButton
            active={mode === "flagged"}
            onClick={() => setMode("flagged")}
            label={`⚑ Flagged (${flaggedActions.length})`}
            danger={flaggedActions.length > 0}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">
          {mode === "flagged" ? "No flagged actions — clean stream." : "No audited actions yet."}
        </p>
      ) : (
        <ul className="divide-y divide-card-border/50">
          {rows.map((row) => {
            const cat = categoryMeta(row.category);
            return (
              <li key={row._id} className="flex items-start gap-2.5 py-2">
                <span
                  aria-hidden
                  className={`mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full ${cat.dot}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-foreground/90" title={summarizeRecord(row)}>
                    {summarizeRecord(row)}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={`rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${cat.badge}`}
                    >
                      {cat.label}
                    </span>
                    <span className="font-mono text-[10px] tracking-tight text-muted">
                      {row.action}
                    </span>
                    {row.outcome !== "ok" && (
                      <span
                        className={`text-[10px] font-semibold uppercase ${
                          row.outcome === "error" ? "text-red-400" : "text-amber-400"
                        }`}
                      >
                        {row.outcome}
                      </span>
                    )}
                    <FlagChips flags={row.flags} />
                  </div>
                </div>
                <span
                  className="flex-shrink-0 whitespace-nowrap text-right text-[10px] tabular-nums text-muted"
                  title={formatTimestamp(row.ts)}
                >
                  t{row.turn}
                  <br />
                  {formatRelative(row.ts)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function StreamButton({
  active,
  onClick,
  label,
  danger = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none ${
        active
          ? "bg-card-elevated text-foreground"
          : danger
            ? "text-red-400/80 hover:text-red-400"
            : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
