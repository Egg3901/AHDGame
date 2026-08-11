"use client";

import { useState } from "react";
import Link from "next/link";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalIdentity } from "@/lib/constants/nationalIdentity";
import { formatFundsCompact } from "@/lib/utils/formatters";
import { Meter, StackBar, type StackSegment } from "./primitives";

/**
 * Expandable revenue / spending breakdown (ported from the design prototype
 * `bbreakdowns.jsx`): a stacked bar over a row accordion. Revenue rows expand to
 * policy rate / tax base / share; spending rows to share / priority / active
 * measures, with driving-legislation chips and grant-recipient meters. The
 * State-Enterprise line deep-links to the National Corporation page.
 */

export interface BreakdownLaw {
  title: string;
  cost: string;
  /** Year the measure was enacted (shown muted on the chip). */
  year?: number;
}

export interface BreakdownGrant {
  id: string;
  name: string;
  amount: number;
}

export interface BreakdownLine {
  id: string;
  label: string;
  description: string;
  amount: number;
  /** Revenue: policy rate % (null ⇒ baseline receipts, no explicit lever). */
  rate?: number | null;
  /** Revenue: tax base (null ⇒ not modelled via one base). */
  base?: number | null;
  /** Spending: legislation driving this line. */
  laws?: BreakdownLaw[];
  /** Spending: intergovernmental-grant recipients (the grants line only). */
  grants?: BreakdownGrant[];
  /** Spending: this is the debt-service line (rate-driven). */
  isDebt?: boolean;
  /** This line is the State-Enterprise remittance → deep-link to the NatCorp. */
  soeLink?: boolean;
  /**
   * Per-turn line (e.g. State Enterprises): shown with a "/turn" suffix and no
   * share, and excluded from the (annual) stacked bar so the bar stays balanced.
   */
  perTurn?: boolean;
}

// Data-viz ramps (chart exception), matched to the sankey for visual continuity.
const REV_COLORS = [
  "#3b82f6",
  "#f59e0b",
  "#14b8a6",
  "#22d3ee",
  "#a855f7",
  "#fb923c",
  "#38bdf8",
  "#f472b6",
  "#a3e635",
  "#d8b25e",
  "#94a3b8",
];
const SPEND_COLORS = [
  "#3b82f6",
  "#eab308",
  "#14b8a6",
  "#f97316",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#94a3b8",
];

function priority(pct: number): string {
  if (pct >= 18) return "Very high";
  if (pct >= 10) return "High";
  if (pct >= 5) return "Core";
  return "Targeted";
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "gold" }) {
  return (
    <div className="rounded-md bg-card px-2.5 py-1.5">
      <div className="text-[8px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`mt-0.5 font-mono text-body-xs font-bold tabular-nums ${tone === "gold" ? "text-gold" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

interface BudgetBreakdownPanelProps {
  kind: "revenue" | "spending";
  title: string;
  lines: BreakdownLine[];
  total: number;
  sym: string;
  countryCode: CountryId;
  grantRecipientLabel: string;
}

export function BudgetBreakdownPanel({
  kind,
  title,
  lines,
  total,
  sym,
  countryCode,
  grantRecipientLabel,
}: BudgetBreakdownPanelProps) {
  const isRev = kind === "revenue";
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<StackSegment | null>(null);
  const money = (n: number) => formatFundsCompact(n, sym);
  const palette = isRev ? REV_COLORS : SPEND_COLORS;
  const corpGlyph = getNationalIdentity(countryCode).glyph;
  // The country's nationalization hub (state enterprises + marketplace).
  const natCorpHref = `/country/${countryCode.toLowerCase()}/nationalization`;
  // The public State Ownership Register (country-wide takings + privatizations).
  const registerHref = `/country/${countryCode.toLowerCase()}/state-ownership`;

  const colored = lines
    .map((l, i) => ({ ...l, color: palette[i % palette.length] }))
    .sort((a, b) => b.amount - a.amount);

  // Per-turn lines (State Enterprises) are excluded from the annual stacked bar.
  const segments: StackSegment[] = colored
    .filter((l) => !l.perTurn)
    .map((l) => ({
      key: l.id,
      label: l.label.split(" (")[0].split(" — ")[0],
      value: l.amount,
      color: l.color,
    }));

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{title}</div>
          <div className="truncate text-body-xs text-muted">
            {isRev ? "Where receipts come from" : "Where outlays go"} · total {money(total)}
          </div>
        </div>
        {hover && (
          <span className="shrink-0 text-body-xs font-semibold text-gold">
            {hover.label}: {money(hover.value)}
          </span>
        )}
      </div>

      <StackBar segments={segments} total={total} formatValue={money} onHover={setHover} />

      <div className="mt-3 divide-y divide-card-border">
        {colored.map((l) => {
          const pct = total > 0 ? (l.amount / total) * 100 : 0;
          const isOpen = open === l.id;
          return (
            <div key={l.id}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : l.id)}
                className="flex w-full items-center gap-3 py-2 text-left hover:bg-card-elevated/40"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: l.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body-sm font-medium text-foreground">
                      {l.label}
                    </span>
                    {l.soeLink && (
                      <span className="shrink-0 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold text-gold">
                        National Corp →
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="font-mono text-body-sm font-semibold tabular-nums text-foreground">
                    {money(l.amount)}
                    {l.perTurn && <span className="text-[10px] font-normal text-muted">/turn</span>}
                  </span>
                  <div className="text-[10px] tabular-nums text-muted">
                    {l.perTurn ? "—" : `${pct.toFixed(1)}%`}
                  </div>
                </div>
                <svg
                  className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {isOpen && (
                <div className="mb-2 ml-5 rounded-lg border border-card-border bg-card-muted p-3">
                  <p className="text-body-sm leading-snug text-foreground/85">{l.description}</p>
                  {!l.perTurn && (
                    <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {isRev ? (
                        <>
                          <Mini
                            label="Policy rate"
                            value={l.rate != null ? `${l.rate.toFixed(1)}%` : "Baseline"}
                          />
                          <Mini label="Tax base" value={l.base != null ? money(l.base) : "N/A"} />
                          <Mini label="Share of revenue" value={`${pct.toFixed(1)}%`} tone="gold" />
                        </>
                      ) : (
                        <>
                          <Mini
                            label="Share of spending"
                            value={`${pct.toFixed(1)}%`}
                            tone="gold"
                          />
                          <Mini label="Priority" value={priority(pct)} />
                          <Mini
                            label="Active measures"
                            value={
                              l.laws && l.laws.length > 0
                                ? String(l.laws.length)
                                : l.isDebt
                                  ? "rate-driven"
                                  : "baseline"
                            }
                          />
                        </>
                      )}
                    </div>
                  )}

                  {l.soeLink && (
                    <Link
                      href={natCorpHref}
                      className="mt-2.5 flex items-center gap-2.5 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 transition-colors hover:bg-gold/20"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gold/50 bg-gold/15 text-body-sm font-bold text-gold">
                        {corpGlyph}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-body-xs font-semibold text-gold">
                          Open the National Corporation
                        </span>
                        <span className="block text-[11px] text-muted">
                          See the state enterprise behind this line
                        </span>
                      </span>
                      <svg
                        className="h-4 w-4 shrink-0 text-gold"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden
                      >
                        <path
                          fillRule="evenodd"
                          d="M5 10a.75.75 0 01.75-.75h6.638L10.23 7.29a.75.75 0 111.04-1.08l3.5 3.25a.75.75 0 010 1.08l-3.5 3.25a.75.75 0 11-1.04-1.08l2.158-1.96H5.75A.75.75 0 015 10z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </Link>
                  )}

                  {l.soeLink && (
                    <Link
                      href={registerHref}
                      className="mt-2 flex items-center gap-2.5 rounded-lg border border-card-border bg-card-muted px-3 py-2 transition-colors hover:bg-card-elevated"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-body-xs font-semibold text-foreground">
                          State ownership register
                        </span>
                        <span className="block text-[11px] text-muted">
                          Every nationalization and privatization this country has made
                        </span>
                      </span>
                      <svg
                        className="h-4 w-4 shrink-0 text-muted"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden
                      >
                        <path
                          fillRule="evenodd"
                          d="M5 10a.75.75 0 01.75-.75h6.638L10.23 7.29a.75.75 0 111.04-1.08l3.5 3.25a.75.75 0 010 1.08l-3.5 3.25a.75.75 0 11-1.04-1.08l2.158-1.96H5.75A.75.75 0 015 10z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </Link>
                  )}

                  {l.laws && l.laws.length > 0 && (
                    <div className="mt-2.5">
                      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-muted">
                        {isRev ? "Governing statutes" : "Driving legislation"}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {l.laws.map((law, lawIdx) => (
                          <span
                            key={`${law.title}-${lawIdx}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-card-border bg-card px-2 py-1 text-[11px]"
                          >
                            <span className="text-foreground">{law.title}</span>
                            {law.cost && <span className="text-gold">{law.cost}</span>}
                            {law.year != null && <span className="text-muted">· {law.year}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {l.grants && l.grants.length > 0 && (
                    <div className="mt-2.5">
                      <div className="mb-1 text-[8px] font-bold uppercase tracking-wide text-muted">
                        Top recipients · {grantRecipientLabel}
                      </div>
                      <div className="space-y-1">
                        {l.grants.slice(0, 4).map((g) => (
                          <div key={g.id} className="flex items-center gap-2">
                            <span className="w-28 shrink-0 truncate text-[11px] text-muted">
                              {g.name}
                            </span>
                            <div className="flex-1">
                              <Meter
                                value={(g.amount / (l.grants![0].amount || 1)) * 100}
                                tone="gold"
                                height={5}
                              />
                            </div>
                            <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground">
                              {money(g.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
