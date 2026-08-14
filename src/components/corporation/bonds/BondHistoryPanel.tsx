"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import { countryUrl } from "@/lib/urls";
import { LocalTime } from "@/components/time/LocalTime";
import {
  useBondHistory,
  type BondHistoryDirection,
  type BondHistoryEntry,
  type BondHistoryParty,
  type BondHistoryBondInfo,
} from "./hooks/useBondHistory";

interface BondHistoryPanelProps {
  corpId: string;
  /**
   * Bumping (or changing referentially) re-runs the fetch. BondsTab passes
   * the parent's bondInfo so a corp-data refresh propagates here too.
   */
  refreshKey?: unknown;
}

const TURNS_PER_PAGE = 10;

// Human-readable label for a (type, source, refinance) tuple. Keep grounded
// in the emit semantics — see src/lib/turn/bondTurn.ts and the bond-default
// routes.
function entryLabel(e: BondHistoryEntry): string {
  if (e.type === "bond_coupon") {
    return e.source === "issuer_coupon" ? "Coupon paid" : "Coupon received";
  }
  if (e.type === "bond_maturity") {
    if (e.source === "issuer_repayment") return "Bond repaid (matured)";
    if (e.source === "default_cash_payoff") return "Default cured (cash)";
    if (e.source === "parent_bond_payoff") return "Parent payoff";
    return e.amount > 0 ? "Bond matured (received)" : "Bond matured (paid)";
  }
  if (e.type === "bond_purchase") return "Bond purchased";
  if (e.type === "bond_issuance") return e.refinance ? "Bond refinanced" : "Bond issued";
  if (e.type === "bond_default") return "Bond default";
  if (e.type === "bond_dissolution_payout") return "Dissolution payout";
  return e.type;
}

function formatAmount(amount: number, currency: string): string {
  const sign = amount < 0 ? "-" : amount > 0 ? "+" : "";
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${formatted} ${currency}`;
}

function formatAnchor(amount: number): string {
  const sign = amount < 0 ? "-" : amount > 0 ? "+" : "";
  const abs = Math.abs(amount);
  return `${sign}${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₳`;
}

function PartyLink({ party }: { party: BondHistoryParty | null }) {
  if (!party) return <span className="text-muted italic">—</span>;
  if (party.kind === "character" && party.characterId) {
    return (
      <Link
        href={`/character/${party.characterId}`}
        className="text-foreground hover:text-primary hover:underline"
      >
        {party.name}
      </Link>
    );
  }
  if (party.kind === "corporation" && party.corporationId) {
    return (
      <Link
        href={`/corporation/${party.corporationId}`}
        className="text-foreground hover:text-primary hover:underline"
      >
        {party.name}
      </Link>
    );
  }
  if (party.kind === "government" && party.countryId) {
    return (
      <Link
        href={countryUrl(party.countryId)}
        className="text-foreground hover:text-primary hover:underline"
      >
        {party.name}
      </Link>
    );
  }
  return <span className="text-foreground">{party.name}</span>;
}

function BondLink({ bond }: { bond: BondHistoryBondInfo | null }) {
  if (!bond) return <span className="text-muted italic">—</span>;
  const label = `${bond.issuerName} · ${bond.couponRate}% matur T${bond.maturityTurn}`;
  return (
    <Link
      href={`/bond/${bond.bondId}`}
      className="text-foreground hover:text-primary hover:underline"
      title={label}
    >
      {label}
    </Link>
  );
}

function TurnAccordion({ turn, entries }: { turn: number; entries: BondHistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  const totals = useMemo(() => {
    const incomes = new Map<string, number>();
    const payments = new Map<string, number>();
    let anchorIncome = 0;
    let anchorPayment = 0;
    let anchorCovered = 0;
    for (const e of entries) {
      const target = e.amount >= 0 ? incomes : payments;
      target.set(e.currencyCode, (target.get(e.currencyCode) ?? 0) + e.amount);
      if (typeof e.anchorAmount === "number") {
        if (e.anchorAmount >= 0) anchorIncome += e.anchorAmount;
        else anchorPayment += e.anchorAmount;
        anchorCovered += 1;
      }
    }
    return {
      incomes,
      payments,
      anchorIncome,
      anchorPayment,
      anchorComplete: anchorCovered === entries.length && entries.length > 0,
    };
  }, [entries]);

  function summaryText(map: Map<string, number>): string {
    const parts: string[] = [];
    for (const [ccy, amt] of map) {
      if (amt === 0) continue;
      parts.push(formatAmount(amt, ccy));
    }
    return parts.length ? parts.join(", ") : "—";
  }

  const incomeText = summaryText(totals.incomes);
  const paymentText = summaryText(totals.payments);

  return (
    <div className="rounded-lg border border-card-border bg-card-elevated/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-card-elevated/70 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs transition-transform ${
              open ? "rotate-90" : ""
            } text-muted`}
            aria-hidden
          >
            ▶
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground">Turn {turn}</div>
            <div className="text-xs text-muted">
              {entries.length} {entries.length === 1 ? "event" : "events"}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end text-xs tabular-nums">
          <span className="text-success">+ {incomeText}</span>
          <span className="text-error">− {paymentText.replace(/^-/, "")}</span>
          {totals.anchorComplete && (
            <span
              className="text-muted mt-0.5"
              title="Anchor currency (₳) — cross-currency net total summed from each row's anchor snapshot"
            >
              ≈ {formatAnchor(totals.anchorIncome + totals.anchorPayment)}
            </span>
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-card-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium">Counterparty</th>
                <th className="px-4 py-2 font-medium">Bond</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {entries.map((e) => {
                const isIncome = e.amount > 0;
                const amountClass = isIncome
                  ? "text-success"
                  : e.amount < 0
                    ? "text-error"
                    : "text-muted";
                return (
                  <tr key={e.id} className="align-top">
                    <td className="px-4 py-2 text-muted whitespace-nowrap">
                      <LocalTime
                        value={e.createdAt}
                        options={{ hour: "2-digit", minute: "2-digit", second: "2-digit" }}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-foreground">{entryLabel(e)}</div>
                      {e.units != null && (
                        <div className="text-xs text-muted">
                          {e.units.toLocaleString("en-US")} units
                          {e.couponRate != null && ` @ ${e.couponRate}%`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <PartyLink party={e.counterparty} />
                    </td>
                    <td className="px-4 py-2">
                      <BondLink bond={e.bond} />
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${amountClass}`}
                    >
                      <div>{formatAmount(e.amount, e.currencyCode)}</div>
                      {e.bondAmount != null && e.bondCurrency && (
                        <div className="text-xs text-muted">
                          ≈ {formatAmount(e.bondAmount, e.bondCurrency)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function BondHistoryPanel({ corpId, refreshKey }: BondHistoryPanelProps) {
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<BondHistoryDirection>("all");
  // Server applies the direction filter and clamps `page` to `[1, pageCount]`,
  // so pageCount + entries always agree. The hook returns `serverPage` as the
  // canonical clamped page; we render that.
  const { entries, pageCount, totalTurns, windowTurns, serverPage, loading, error } =
    useBondHistory(corpId, page, TURNS_PER_PAGE, direction, refreshKey);

  // Group the page's entries by turn (server already paged by turn so every
  // turn's row set is complete on this page).
  const grouped = useMemo(() => {
    const byTurn = new Map<number, BondHistoryEntry[]>();
    for (const e of entries) {
      const arr = byTurn.get(e.turn);
      if (arr) arr.push(e);
      else byTurn.set(e.turn, [e]);
    }
    return [...byTurn.entries()].sort((a, b) => b[0] - a[0]);
  }, [entries]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Bond History</h2>
            <p className="text-xs text-muted">
              Income and payments from this corporation&apos;s bond activity. Each turn expands into
              the underlying events. Retention is capped at the financial-ledger window (
              {windowTurns} turns ≈ 7 days).
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-card-elevated p-1 border border-card-border">
            {(
              [
                { key: "all", label: "All" },
                { key: "income", label: "Income" },
                { key: "payment", label: "Payments" },
              ] as { key: BondHistoryDirection; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDirection(key);
                  setPage(1);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  direction === key
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}

        {!loading && !error && grouped.length === 0 && (
          <div className="rounded-md border border-dashed border-card-border p-8 text-center text-sm text-muted">
            {totalTurns === 0 ? (
              direction === "all" ? (
                `No bond activity in the last ${windowTurns} turns.`
              ) : (
                <>
                  <div>
                    No {direction === "income" ? "income" : "payment"} activity in the last{" "}
                    {windowTurns} turns.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDirection("all");
                      setPage(1);
                    }}
                    className="mt-2 text-xs text-primary hover:underline"
                  >
                    Switch to All to see other bond events
                  </button>
                </>
              )
            ) : (
              "No matches on this page."
            )}
          </div>
        )}

        {!loading && grouped.length > 0 && (
          <>
            <div className="space-y-2">
              {grouped.map(([turn, turnEntries]) => (
                <TurnAccordion key={turn} turn={turn} entries={turnEntries} />
              ))}
            </div>

            {pageCount > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(1, serverPage - 1))}
                  disabled={serverPage <= 1 || loading}
                  className="rounded-md border border-card-border px-3 py-1.5 text-sm hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-sm text-muted">
                  Page {serverPage} of {pageCount} · {totalTurns}{" "}
                  {totalTurns === 1 ? "turn" : "turns"}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(pageCount, serverPage + 1))}
                  disabled={serverPage >= pageCount || loading}
                  className="rounded-md border border-card-border px-3 py-1.5 text-sm hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
