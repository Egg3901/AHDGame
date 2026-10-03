"use client";

import { Fragment, useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDefenceView } from "./CorporationPageTypes";
import { DenseSection, InlineStatus, SmallButton, TableScroll, Td, Th } from "./dense/DenseKit";

const GRADE_LABEL = ["None", "Legacy", "Modernised", "Cutting-edge"];

/**
 * A delivery rate can be well under one lot per turn for a small plant; it still delivers, just
 * slowly, as the fractional output accumulates. Show that honestly rather than rounding it to a
 * flat "0/turn" that reads as broken.
 */
function formatRate(n: number): string {
  if (n <= 0) return "0";
  if (n >= 10) return Math.round(n).toLocaleString("en-US");
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
}

const STATUS_TONE: Record<string, string> = {
  pending: "text-warning",
  active: "text-success",
  complete: "text-muted",
  cancelled: "text-error",
  declined: "text-muted",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Offered",
  active: "Active",
  complete: "Complete",
  cancelled: "Terminated",
  declined: "Declined",
};

/**
 * The supplying CEO's side of defence procurement: offers awaiting an answer, the live order
 * book, what it has paid, and the quality ceiling the corporation's research puts on what it
 * can deliver.
 *
 * The minister's Arsenal tab and this panel read the same contracts from opposite ends, but a
 * CEO's questions are different: they cannot see the national stockpile, and what they need
 * is throughput and revenue rather than shortfall, so this is a distinct view rather than the
 * ministerial one re-pointed.
 */
export default function DefenceContractsTab({
  corpId,
  defence,
  isCeo,
  onUpdate,
}: {
  corpId: string;
  defence?: CorporationDefenceView;
  isCeo: boolean;
  onUpdate?: () => void;
}) {
  const { formatAmount } = useCurrency();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contracts = defence?.contracts ?? [];
  const pending = contracts.filter((c) => c.status === "pending");
  const active = contracts.filter((c) => c.status === "active");
  // Throughput is the number a CEO can act on: it is what re-tooling or expanding a plant
  // changes, and it counts only lines already committed, not offers still unanswered.
  const perTurn = active.reduce((s, c) => s + c.projectedLotsPerTurn, 0);
  const outstanding = active.reduce((s, c) => s + Math.max(0, c.lotsOrdered - c.lotsDelivered), 0);
  const grade = Math.max(0, Math.min(3, Math.round(defence?.gradeCeiling ?? 0)));
  async function setFactories(contractId: string, assignedFactories: number) {
    setBusyId(contractId);
    setError(null);
    try {
      const res = await fetch(
        `/api/corporations/${corpId}/defence-contracts/${contractId}/factories`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignedFactories }),
        }
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Those production lines could not be assigned.");
        return;
      }
      onUpdate?.();
    } catch {
      setError("That request could not be sent.");
    } finally {
      setBusyId(null);
    }
  }

  async function respond(contractId: string, action: "accept" | "decline") {
    setBusyId(contractId);
    setError(null);
    try {
      const res = await fetch(`/api/corporations/${corpId}/defence-contracts/${contractId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        // The offer can be withdrawn by the minister between render and click; say so rather
        // than leaving a button that appears to do nothing.
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "That offer could not be answered.");
        return;
      }
      onUpdate?.();
    } catch {
      setError("That request could not be sent.");
    } finally {
      setBusyId(null);
    }
  }

  const figure = (label: string, value: string, title?: string) => (
    <div className="min-w-0" title={title}>
      <dt className="truncate text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-sm font-medium tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <DenseSection title="Defence procurement">
        <dl
          aria-label="Procurement summary"
          className="grid grid-cols-3 gap-x-6 gap-y-3 py-1 lg:grid-cols-6"
        >
          {figure("Offers awaiting you", pending.length.toLocaleString("en-US"))}
          {figure("Lots outstanding", outstanding.toLocaleString("en-US"))}
          {figure("Lots per turn", formatRate(perTurn))}
          {figure("Earned to date", formatAmount(defence?.totalEarned ?? 0))}
          {figure("Margin after build cost", formatAmount(defence?.totalNetMargin ?? 0))}
          {figure("Committed by buyers", formatAmount(defence?.totalEncumbered ?? 0))}
        </dl>
        <p className="border-t border-card-border/60 py-1.5 text-xs text-muted">
          <span className="font-medium text-foreground">Delivery grade </span>
          <span className="font-medium text-foreground">{GRADE_LABEL[grade]}</span>
          <span className="font-mono tabular-nums"> ({grade} of 3)</span>. The best quality this
          corporation can currently build, set by the technology decades its research has reached.
          Governments receive materiel at this grade, so improving it raises the value of everything
          you deliver.
        </p>
      </DenseSection>

      <InlineStatus message={error} tone="error" />

      {pending.length > 0 && (
        <DenseSection title="Offers awaiting your answer" meta={`${pending.length}`}>
          <p className="py-1 text-xs text-muted">
            A government has offered these orders. Nothing is built and nothing is paid until you
            accept. Once you do, the plant&apos;s output goes to the arsenal instead of the open
            market.
          </p>
          <TableScroll>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Plant</Th>
                  <Th align="right">Per lot</Th>
                  <Th align="right">Worth</Th>
                  <Th
                    align="right"
                    title="Turns to deliver the order at the plant's current output"
                  >
                    Time
                  </Th>
                  {isCeo && (
                    <Th align="right">
                      <span className="sr-only">Answer</span>
                    </Th>
                  )}
                </tr>
              </thead>
              <tbody>
                {pending.map((c) => (
                  <Fragment key={c._id}>
                    <tr>
                      <Td className="text-foreground">
                        {c.countryId} · {c.lotsOrdered.toLocaleString("en-US")} lots of{" "}
                        {c.component}
                      </Td>
                      <Td className="text-muted">{c.plantLabel}</Td>
                      <Td align="right">{formatAmount(c.pricePerLot)}</Td>
                      <Td align="right">{formatAmount(c.pricePerLot * c.lotsOrdered)}</Td>
                      <Td align="right" className="text-muted">
                        {c.projectedLotsPerTurn > 0
                          ? `${Math.ceil(c.lotsOrdered / c.projectedLotsPerTurn).toLocaleString("en-US")} turns`
                          : ""}
                      </Td>
                      {isCeo && (
                        <Td align="right" numeric={false}>
                          <span className="inline-flex gap-1.5">
                            <SmallButton
                              tone="primary"
                              disabled={busyId === c._id}
                              onClick={() => void respond(c._id, "accept")}
                            >
                              Accept
                            </SmallButton>
                            <SmallButton
                              disabled={busyId === c._id}
                              onClick={() => void respond(c._id, "decline")}
                            >
                              Decline
                            </SmallButton>
                          </span>
                        </Td>
                      )}
                    </tr>
                    {c.projectedLotsPerTurn === 0 && (
                      <tr>
                        <td colSpan={isCeo ? 6 : 5} className="pb-1.5 pl-2 text-xs text-error">
                          This plant is currently producing nothing, so accepting would not start
                          deliveries until its output recovers.
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </DenseSection>
      )}

      <DenseSection title="Order book" meta={contracts.length ? `${contracts.length}` : undefined}>
        <p className="py-1 text-xs text-muted">
          Every order this corporation has been offered. Each pays per lot on delivery. Nothing is
          paid up front, and a plant re-tooled off its contracted component stops earning.
        </p>
        {contracts.length === 0 ? (
          <p className="py-2 text-xs text-muted">
            {isCeo
              ? "No government has offered this corporation a contract. Defence ministers award them from their own cabinet office; a plant running a line that builds materiel is what makes you eligible."
              : "This corporation holds no government procurement contracts."}
          </p>
        ) : (
          <TableScroll>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Contract</Th>
                  <Th>Status</Th>
                  <Th align="right">Delivered</Th>
                  <Th>Progress</Th>
                  <Th align="right">Per lot</Th>
                  <Th align="right" title="Margin per lot after the cost to build it">
                    Margin
                  </Th>
                  <Th align="right">Paid</Th>
                  <Th align="right">Build cost</Th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const pct = c.lotsOrdered > 0 ? (c.lotsDelivered / c.lotsOrdered) * 100 : 0;
                  const remaining = Math.max(0, c.lotsOrdered - c.lotsDelivered);
                  // A live contract with no output is the one actionable failure here: the
                  // plant has been re-tooled off the component, or its production has collapsed.
                  const stalled = c.status === "active" && c.projectedLotsPerTurn === 0;
                  const margin =
                    c.unitProductionCost != null ? c.pricePerLot - c.unitProductionCost : null;
                  const notes: { text: string; tone: string }[] = [];
                  if (c.lotsBuiltNotDelivered > 0 || c.partialLot > 0) {
                    notes.push({
                      text: `${c.lotsBuiltNotDelivered.toLocaleString("en-US")} built and waiting${
                        c.partialLot > 0 ? `, ${(c.partialLot * 100).toFixed(0)}% of another` : ""
                      }.`,
                      tone: "text-warning",
                    });
                  }
                  if (c.unitProductionCost == null) {
                    notes.push({
                      text: "Build cost unknown: the certified plant is gone.",
                      tone: "text-muted",
                    });
                  }
                  if (c.encumberedAmount > 0) {
                    notes.push({
                      text: `${formatAmount(c.encumberedAmount)} committed by the buyer.`,
                      tone: "text-muted",
                    });
                  }
                  if (c.carryReasonText)
                    notes.push({ text: c.carryReasonText, tone: "text-warning" });
                  if (c.selfDealing) {
                    notes.push({
                      text: `Declared interest: ${c.selfDealing.ministerName ?? "the awarding minister"} ${
                        c.selfDealing.basis === "owner"
                          ? "owns this corporation"
                          : `holds ${(c.selfDealing.stakeShare * 100).toFixed(1)}% of it`
                      }. This award is on the public record.`,
                      tone: "text-error",
                    });
                  }
                  if (c.termination) {
                    notes.push({
                      text:
                        c.termination.basis === "withdrawal"
                          ? `Offer withdrawn by ${c.termination.ministerName ?? "the minister"} before you answered it.`
                          : c.termination.basis === "cause"
                            ? `Terminated for cause on ${c.termination.lotsCancelled.toLocaleString("en-US")} undelivered lots. The plant had stopped delivering, so no break fee was owed.`
                            : `Terminated by ${c.termination.ministerName ?? "the minister"} on ${c.termination.lotsCancelled.toLocaleString("en-US")} undelivered lots. You were paid ${formatAmount(c.termination.fee)} in break fees.`,
                      tone: "text-warning",
                    });
                  }
                  if (stalled) {
                    notes.push({
                      text: `Delivering nothing. This plant is either re-tooled off ${c.component} or producing no output, and the order will not advance until that changes.`,
                      tone: "text-error",
                    });
                  }
                  const showLines = isCeo && (c.status === "active" || c.status === "pending");
                  return (
                    <Fragment key={c._id}>
                      <tr>
                        <Td className="text-foreground">
                          {c.countryId} · {c.component}
                          {c.plantLabel ? ` · ${c.plantLabel}` : ""}
                        </Td>
                        <Td className={STATUS_TONE[c.status] ?? "text-muted"}>
                          {STATUS_LABEL[c.status] ?? c.status}
                        </Td>
                        <Td align="right">
                          {c.lotsDelivered.toLocaleString("en-US")} /{" "}
                          {c.lotsOrdered.toLocaleString("en-US")}
                        </Td>
                        <Td className="text-xs text-muted">
                          {c.status === "active"
                            ? `${remaining.toLocaleString("en-US")} outstanding, ${formatRate(c.projectedLotsPerTurn)}/turn`
                            : c.status === "pending"
                              ? "awaiting your answer"
                              : `${Math.round(pct)}% delivered`}
                        </Td>
                        <Td align="right">{formatAmount(c.pricePerLot)}</Td>
                        <Td
                          align="right"
                          className={
                            margin == null
                              ? "text-muted"
                              : margin >= 0
                                ? "text-success"
                                : "text-error"
                          }
                          title={
                            c.unitProductionCost != null
                              ? `Costs ${formatAmount(c.unitProductionCost)} per lot to build`
                              : undefined
                          }
                        >
                          {margin == null ? "n/a" : formatAmount(margin)}
                        </Td>
                        <Td align="right">{formatAmount(c.amountPaid)}</Td>
                        <Td align="right" className="text-muted">
                          {formatAmount(c.productionCostPaid)}
                        </Td>
                      </tr>
                      {(notes.length > 0 || showLines) && (
                        <tr>
                          <td
                            colSpan={8}
                            className="space-y-1 border-b border-card-border/60 pb-2 pl-4 pr-2 text-xs"
                          >
                            {notes.map((n) => (
                              <p key={n.text} className={n.tone}>
                                {n.text}
                              </p>
                            ))}
                            {showLines && (
                              <div className="flex flex-wrap items-center gap-1.5 text-muted">
                                <span>Production lines</span>
                                {Array.from({ length: c.totalFactories }, (_, i) => i + 1).map(
                                  (n) => (
                                    <button
                                      key={n}
                                      type="button"
                                      disabled={busyId === c._id || n === c.assignedFactories}
                                      onClick={() => void setFactories(c._id, n)}
                                      aria-pressed={n === c.assignedFactories}
                                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded border px-1.5 font-mono text-[11px] ${
                                        n === c.assignedFactories
                                          ? "border-foreground bg-foreground font-medium text-background"
                                          : "border-card-border text-foreground hover:bg-card-elevated disabled:opacity-60"
                                      }`}
                                    >
                                      {n}
                                    </button>
                                  )
                                )}
                                <span>
                                  of {c.totalFactories} lines at {c.plantLabel}. More lines use more
                                  of this plant; they do not add plants, and the price per lot does
                                  not change.
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </DenseSection>
    </div>
  );
}
