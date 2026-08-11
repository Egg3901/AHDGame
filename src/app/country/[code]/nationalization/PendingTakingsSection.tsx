"use client";

import { TIER_LABEL, PATH_LABEL, triggerLabels } from "@/lib/nationalization/labels";
import type { CompensationTier, NationalizationPath } from "@/lib/nationalization/constants";

export interface Pending {
  id: string;
  targetName: string;
  isSector: boolean;
  tier: string;
  method: string;
  triggers: string[];
  curableTriggers: string[];
  noticeDeadlineTurn: number;
  postedAtTurn: number;
}

export function PendingTakingsSection({
  pending,
  currentTurn,
}: {
  pending: Pending[];
  currentTurn: number;
}) {
  return (
    <section className="rounded-xl border border-card-border bg-card p-5">
      <h2 className="text-heading-sm font-semibold text-foreground">Pending takings</h2>
      <p className="mt-1 text-body-sm text-muted">
        Authorized nationalizations in their notice window. Curable conditions cleared before the
        deadline cancel the taking.
      </p>
      {pending.length === 0 ? (
        <p className="mt-4 text-body-sm text-muted">No pending takings.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {pending.map((p) => {
            const turnsLeft = Math.max(0, p.noticeDeadlineTurn - currentTurn);
            return (
              <div
                key={p.id}
                className="rounded-lg border border-card-border bg-card-muted px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body-sm font-medium text-foreground">{p.targetName}</span>
                  <span className="text-body-xs text-muted">
                    {turnsLeft} turn{turnsLeft === 1 ? "" : "s"} left ·{" "}
                    {TIER_LABEL[p.tier as CompensationTier] ?? p.tier} ·{" "}
                    {PATH_LABEL[p.method as NationalizationPath] ?? p.method}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-body-xs text-muted">
                  <span>cited: {triggerLabels(p.triggers)}</span>
                  {p.curableTriggers.length > 0 ? (
                    <span className="text-warning">
                      curable: {triggerLabels(p.curableTriggers)} — clear before turn{" "}
                      {p.noticeDeadlineTurn} to cancel
                    </span>
                  ) : (
                    <span>no curable condition — proceeds at deadline</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
