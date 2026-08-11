"use client";

import { useState } from "react";
import Link from "next/link";
import type { ExecutiveActKind } from "@/lib/constants/executiveSurface";
import { formatStableUtc } from "@/lib/time/localTime";

/** Serialized ExecutiveAct from GET /api/country/[code]/executive/acts. */
export interface LedgerAct {
  kind: ExecutiveActKind;
  title: string;
  detail?: string;
  at: string;
  turn?: number;
  refId: string;
}

const KIND_TONE: Record<ExecutiveActKind, string> = {
  signed: "bg-success/10 text-success",
  vetoed: "bg-error/10 text-error",
  onDesk: "bg-warning/10 text-warning",
  order: "bg-gold/10 text-gold",
  confirmed: "bg-info/10 text-info",
  nominated: "bg-info/10 text-info",
};

type LedgerFilter = "all" | "bills" | "appointments" | "orders";

const FILTER_KINDS: Record<Exclude<LedgerFilter, "all">, ExecutiveActKind[]> = {
  bills: ["signed", "vetoed", "onDesk"],
  appointments: ["confirmed", "nominated"],
  orders: ["order"],
};

function stamp(act: LedgerAct): string {
  if (act.turn !== undefined) return `T ${act.turn}`;
  const date = new Date(act.at);
  if (Number.isNaN(date.getTime())) return "—";
  return formatStableUtc(date, { month: "short", day: "numeric" });
}

/**
 * X acts ledger (locked composite): the turn/date-stamped chronicle of what
 * the executive is doing with its power — chip labels and the orders filter
 * name come from getExecutiveSurface config; rows come from the acts route.
 */
export function ActsLedger({
  acts,
  actLabels,
  ordersFilterLabel,
  footer,
}: {
  acts: LedgerAct[];
  actLabels: Record<ExecutiveActKind, string>;
  /** Label for the orders filter pill (e.g. "Orders", "Directives"). */
  ordersFilterLabel: string;
  /** Footer link slot ("full record on the Congress page →"). */
  footer?: { href: string; label: string };
}) {
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const visible =
    filter === "all" ? acts : acts.filter((act) => FILTER_KINDS[filter].includes(act.kind));

  const pills: { key: LedgerFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "bills", label: "Bills" },
    { key: "appointments", label: "Appointments" },
    { key: "orders", label: ordersFilterLabel },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-card-border bg-card-muted px-4 py-2.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
          Acts of Government
        </span>
        <span className="flex gap-1.5">
          {pills.map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={() => setFilter(pill.key)}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${
                filter === pill.key
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-card-border text-muted hover:text-foreground"
              }`}
              aria-pressed={filter === pill.key}
            >
              {pill.label}
            </button>
          ))}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm italic text-muted">
          No recorded acts{filter !== "all" ? " for this filter" : " yet"}.
        </p>
      ) : (
        <div className="relative py-1.5">
          <span
            aria-hidden
            className="absolute bottom-0 left-[88px] top-0 w-px bg-card-border/50"
          />
          {visible.map((act) => (
            <div
              key={`${act.kind}-${act.refId}`}
              className="relative grid grid-cols-[64px_92px_1fr] items-baseline gap-2.5 px-4 py-2"
            >
              <span className="text-right font-mono text-[10px] text-muted">{stamp(act)}</span>
              <span
                className={`rounded px-1 py-0.5 text-center text-[9px] font-bold tracking-wider ${KIND_TONE[act.kind]}`}
              >
                {actLabels[act.kind]}
              </span>
              <span className="min-w-0 truncate text-sm text-foreground/90">
                {act.title}
                {act.detail && (
                  <span className="ml-1.5 font-mono text-[10px] text-muted">· {act.detail}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {footer && (
        <div className="border-t border-card-border/50 px-4 py-2.5 text-xs text-muted">
          Full record on the{" "}
          <Link
            href={footer.href}
            className="font-semibold text-primary transition-colors hover:text-primary-dark"
          >
            {footer.label} →
          </Link>
        </div>
      )}
    </div>
  );
}
