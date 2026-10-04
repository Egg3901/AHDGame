"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import { countryUrl } from "@/lib/urls";
import { LocalTime } from "@/components/time/LocalTime";
import {
  DenseSection,
  InlineStatus,
  Segmented,
  SmallButton,
  TableScroll,
  Td,
  Th,
} from "../dense/DenseKit";
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
// in the emit semantics (see src/lib/turn/bondTurn.ts and the bond-default
// routes).
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
  if (!party) return <span className="text-muted">none</span>;
  if (party.kind === "character" && party.characterId) {
    return (
      <Link href={`/character/${party.characterId}`} className="text-foreground hover:underline">
        {party.name}
      </Link>
    );
  }
  if (party.kind === "corporation" && party.corporationId) {
    return (
      <Link
        href={`/corporation/${party.corporationId}`}
        className="text-foreground hover:underline"
      >
        {party.name}
      </Link>
    );
  }
  if (party.kind === "government" && party.countryId) {
    return (
      <Link href={countryUrl(party.countryId)} className="text-foreground hover:underline">
        {party.name}
      </Link>
    );
  }
  return <span className="text-foreground">{party.name}</span>;
}

function BondLink({ bond }: { bond: BondHistoryBondInfo | null }) {
  if (!bond) return <span className="text-muted">none</span>;
  const label = `${bond.issuerName} ${bond.couponRate}%, due T${bond.maturityTurn}`;
  return (
    <Link href={`/bond/${bond.bondId}`} className="text-foreground hover:underline" title={label}>
      {label}
    </Link>
  );
}

function TurnRows({ turn, entries }: { turn: number; entries: BondHistoryEntry[] }) {
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
    return parts.join(", ");
  }

  const incomeText = summaryText(totals.incomes);
  const paymentText = summaryText(totals.payments);
  const net = totals.anchorIncome + totals.anchorPayment;

  return (
    <>
      <tr className="hover:bg-card-elevated/50">
        <Td numeric={false}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
          >
            <span aria-hidden className="w-2 text-[9px] text-muted">
              {open ? "▼" : "▶"}
            </span>
            Turn {turn}
          </button>
        </Td>
        <Td align="right">{entries.length}</Td>
        <Td align="right" className="text-success">
          {incomeText}
        </Td>
        <Td align="right" className="text-error">
          {paymentText}
        </Td>
        <Td
          align="right"
          className={net > 0 ? "text-success" : net < 0 ? "text-error" : "text-muted"}
          title="Anchor currency net, summed from each event's anchor snapshot"
        >
          {totals.anchorComplete ? formatAnchor(net) : ""}
        </Td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="border-b border-card-border/60 bg-card-elevated/30 px-2 pb-2">
            <TableScroll>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Time</Th>
                    <Th>Event</Th>
                    <Th>Counterparty</Th>
                    <Th>Bond</Th>
                    <Th align="right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="align-top">
                      <Td className="font-mono text-muted">
                        <LocalTime
                          value={e.createdAt}
                          options={{ hour: "2-digit", minute: "2-digit", second: "2-digit" }}
                        />
                      </Td>
                      <Td>
                        <span className="text-foreground">{entryLabel(e)}</span>
                        {e.units != null && (
                          <span className="ml-2 font-mono text-[11px] text-muted">
                            {e.units.toLocaleString("en-US")} units
                            {e.couponRate != null && ` at ${e.couponRate}%`}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <PartyLink party={e.counterparty} />
                      </Td>
                      <Td>
                        <BondLink bond={e.bond} />
                      </Td>
                      <Td
                        align="right"
                        className={
                          e.amount > 0 ? "text-success" : e.amount < 0 ? "text-error" : "text-muted"
                        }
                      >
                        {formatAmount(e.amount, e.currencyCode)}
                        {e.bondAmount != null && e.bondCurrency && (
                          <span className="ml-2 text-[11px] text-muted">
                            ({formatAmount(e.bondAmount, e.bondCurrency)})
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </td>
        </tr>
      )}
    </>
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

  const showAll = () => {
    setDirection("all");
    setPage(1);
  };

  return (
    <DenseSection
      title="Bond history"
      meta={`last ${windowTurns} turns`}
      actions={
        <Segmented
          ariaLabel="Bond history filter"
          options={[
            { value: "all", label: "All" },
            { value: "income", label: "Income" },
            { value: "payment", label: "Payments" },
          ]}
          value={direction}
          onChange={(key: BondHistoryDirection) => {
            setDirection(key);
            setPage(1);
          }}
        />
      }
    >
      <p className="py-1 text-xs text-muted">
        Income and payments from this corporation&apos;s bond activity, one row per turn. Open a
        turn for the underlying events. History is kept for the financial ledger window (
        {windowTurns} turns, about 7 days).
      </p>

      <InlineStatus message={error} tone="error" className="py-1" />

      {loading && (
        <div className="space-y-1 pt-1">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      )}

      {!loading && !error && grouped.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 py-2 text-xs text-muted">
          <span>
            {totalTurns === 0
              ? direction === "all"
                ? `No bond activity in the last ${windowTurns} turns.`
                : `No ${direction === "income" ? "income" : "payment"} activity in the last ${windowTurns} turns.`
              : "No matches on this page."}
          </span>
          {totalTurns === 0 && direction !== "all" && (
            <SmallButton onClick={showAll}>Show all bond events</SmallButton>
          )}
        </div>
      )}

      {!loading && grouped.length > 0 && (
        <>
          <TableScroll>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Turn</Th>
                  <Th align="right">Events</Th>
                  <Th align="right">Income</Th>
                  <Th align="right">Payments</Th>
                  <Th align="right" title="Anchor currency net for the turn">
                    Net (₳)
                  </Th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([turn, turnEntries]) => (
                  <TurnRows key={turn} turn={turn} entries={turnEntries} />
                ))}
              </tbody>
            </table>
          </TableScroll>

          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <SmallButton
                onClick={() => setPage(Math.max(1, serverPage - 1))}
                disabled={serverPage <= 1 || loading}
              >
                Previous
              </SmallButton>
              <span className="text-xs text-muted">
                Page {serverPage} of {pageCount}, {totalTurns} {totalTurns === 1 ? "turn" : "turns"}
              </span>
              <SmallButton
                onClick={() => setPage(Math.min(pageCount, serverPage + 1))}
                disabled={serverPage >= pageCount || loading}
              >
                Next
              </SmallButton>
            </div>
          )}
        </>
      )}
    </DenseSection>
  );
}
