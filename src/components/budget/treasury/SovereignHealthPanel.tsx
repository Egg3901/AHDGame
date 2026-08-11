"use client";

import { Fragment } from "react";
import type { SovereignProjection } from "@/lib/publicFinance/queries/federalBudgetDetail";
import type { SovereignCrisisState } from "@/lib/db/types/budget";

/**
 * Sovereign-health panel (ported from the design prototype `bdebt.jsx`): the
 * default-risk state machine (Normal → Warning → Crisis → Recovering) wired to
 * the live `sovereignCrisisState`, plus auction demand, failed-auction count,
 * and market access. Live-only (omitted on historical FY snapshots).
 */

type NodeTone = "up" | "warning" | "down" | "info";

const SOV_NODES: { label: string; tone: NodeTone }[] = [
  { label: "Normal", tone: "up" },
  { label: "Warning", tone: "warning" },
  { label: "Crisis", tone: "down" },
  { label: "Recovering", tone: "info" },
];

function stateToIndex(state: SovereignCrisisState): number {
  switch (state) {
    case "normal":
      return 0;
    case "warning":
      return 1;
    case "crisisPending":
    case "crisisResolving":
      return 2;
    case "recovering":
      return 3;
    default:
      return 0;
  }
}

function narrative(state: SovereignCrisisState): { headline: string; note: string } {
  switch (state) {
    case "warning":
      return {
        headline: "Elevated risk",
        note: "Paying the interest is getting tight and fewer lenders are bidding at auction. If the deficit stays this wide, borrowing gets harder.",
      };
    case "crisisPending":
      return {
        headline: "Crisis",
        note: "The country is close to defaulting. A bond auction has failed, or the interest can no longer be paid. You have to pick a way out.",
      };
    case "crisisResolving":
      return {
        headline: "Crisis · resolving",
        note: "A way out is being worked through: restructure (change the repayment terms), bailout (borrow from abroad), monetize (print the money), or repudiate (refuse to pay). Terms are being settled with lenders.",
      };
    case "recovering":
      return {
        headline: "Recovering",
        note: "Recovering after a default. Lenders are starting to buy your bonds again, and steady budgets are winning back their trust.",
      };
    default:
      return {
        headline: "Stable",
        note: "You can pay the interest with room to spare, and every bond auction sells out. You can borrow as much as you need.",
      };
  }
}

const TONE_TEXT: Record<NodeTone, string> = {
  up: "text-success",
  warning: "text-warning",
  down: "text-error",
  info: "text-info",
};
const TONE_BG: Record<NodeTone, string> = {
  up: "bg-success",
  warning: "bg-warning",
  down: "bg-error",
  info: "bg-info",
};
const TONE_BADGE: Record<NodeTone, string> = {
  up: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  down: "border-error/40 bg-error/10 text-error",
  info: "border-info/40 bg-info/10 text-info",
};

function Signal({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded-md bg-card-muted px-2.5 py-1.5">
      <div className="text-[8px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`mt-0.5 font-mono text-body-xs font-bold tabular-nums ${gold ? "text-gold" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

export function SovereignHealthPanel({ sovereign }: { sovereign: SovereignProjection }) {
  const activeIdx = stateToIndex(sovereign.state);
  const tone = SOV_NODES[activeIdx].tone;
  const { headline, note } = narrative(sovereign.state);

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Sovereign health</div>
          <div className="text-body-xs text-muted">How close you are to defaulting</div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE_BADGE[tone]}`}
        >
          {headline}
        </span>
      </div>

      {/* State-machine track */}
      <div className="flex items-center">
        {SOV_NODES.map((node, i) => {
          const active = i === activeIdx;
          const passed = i < activeIdx;
          return (
            <Fragment key={node.label}>
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                    active
                      ? `${TONE_BG[tone]} text-background`
                      : passed
                        ? "bg-card-elevated text-foreground"
                        : "border border-card-border bg-card-muted text-muted"
                  }`}
                >
                  {i + 1}
                </div>
                <span
                  className={`text-[10px] font-medium ${active ? TONE_TEXT[tone] : "text-muted"}`}
                >
                  {node.label}
                </span>
              </div>
              {i < SOV_NODES.length - 1 && (
                <div
                  className={`mx-1.5 h-px flex-1 ${passed ? "bg-card-elevated" : "bg-card-border"}`}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      <p className="mt-3 text-body-sm leading-snug text-muted">{note}</p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Signal
          label="Auction demand"
          value={sovereign.demandRatio != null ? `${sovereign.demandRatio.toFixed(1)}×` : "—"}
          gold={sovereign.demandRatio != null && sovereign.demandRatio >= 2}
        />
        <Signal label="Failed auctions" value={String(sovereign.failedAuctions)} />
        <Signal label="Market access" value={sovereign.marketAccess} />
      </div>
    </div>
  );
}
