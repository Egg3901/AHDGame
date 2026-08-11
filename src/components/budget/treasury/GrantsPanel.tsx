"use client";

import { formatFundsCompact } from "@/lib/utils/formatters";
import { Meter } from "./primitives";

/**
 * Intergovernmental-grants panel (ported from the design prototype `bdebt.jsx`):
 * recipient rows with a code badge, name, share meter, and amount. Replaces the
 * plain grants accordion on the treasury budget page.
 */

export interface GrantRecipient {
  id: string;
  name: string;
  amount: number;
}

interface GrantsPanelProps {
  title: string;
  recipientLabel: string;
  grants: GrantRecipient[];
  total: number;
  sym: string;
}

export function GrantsPanel({ title, recipientLabel, grants, total, sym }: GrantsPanelProps) {
  const money = (n: number) => formatFundsCompact(n, sym);
  const sorted = [...grants].sort((a, b) => b.amount - a.amount);
  const max = sorted[0]?.amount || 1;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-body-xs text-muted">
          {money(total)} total · by {recipientLabel.toLowerCase()}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-body-sm text-muted">No recipients in the current breakdown.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((g) => (
            <div key={g.id} className="flex items-center gap-3">
              <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded bg-card-elevated text-[10px] font-bold text-muted">
                {g.id.slice(0, 3).toUpperCase()}
              </span>
              <span className="w-32 shrink-0 truncate text-body-xs text-foreground">{g.name}</span>
              <div className="flex-1">
                <Meter value={(g.amount / max) * 100} tone="gold" height={6} />
              </div>
              <span className="w-16 shrink-0 text-right font-mono text-body-xs font-semibold tabular-nums text-foreground">
                {money(g.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
