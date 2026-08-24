"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDefenceView } from "./CorporationPageTypes";

const GRADE_LABEL = ["None", "Legacy", "Modernised", "Cutting-edge"];

/**
 * A delivery rate can be well under one lot per turn for a small plant — it still delivers, just
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
  pending: "text-[var(--warning)] border-[color-mix(in_srgb,var(--warning)_45%,transparent)]",
  active: "text-[var(--success)] border-[color-mix(in_srgb,var(--success)_40%,transparent)]",
  complete: "text-muted border-card-border",
  cancelled: "text-[var(--error)] border-[color-mix(in_srgb,var(--error)_40%,transparent)]",
  declined: "text-muted border-card-border",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "offered",
  active: "active",
  complete: "complete",
  cancelled: "terminated",
  declined: "declined",
};

/**
 * The supplying CEO's side of defence procurement: offers awaiting an answer, the live order
 * book, what it has paid, and the quality ceiling the corporation's research puts on what it
 * can deliver.
 *
 * The minister's Arsenal tab and this panel read the same contracts from opposite ends, but a
 * CEO's questions are different — they cannot see the national stockpile, and what they need
 * is throughput and revenue rather than shortfall — so this is a distinct view rather than the
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
  // Throughput is the number a CEO can act on — it is what re-tooling or expanding a plant
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Offers awaiting you" value={pending.length.toLocaleString("en-US")} />
        <Tile label="Lots outstanding" value={outstanding.toLocaleString("en-US")} />
        <Tile label="Lots per turn" value={formatRate(perTurn)} />
        <Tile label="Earned to date" value={formatAmount(defence?.totalEarned ?? 0)} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
        <Tile label="Margin after build cost" value={formatAmount(defence?.totalNetMargin ?? 0)} />
        <Tile label="Committed by buyers" value={formatAmount(defence?.totalEncumbered ?? 0)} />
      </div>

      {error && (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--error)]">
          {error}
        </div>
      )}

      {pending.length > 0 && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-card">
          <div className="border-b border-card-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground">Offers awaiting your answer</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              A government has offered these orders. Nothing is built and nothing is paid until you
              accept — and once you do, the plant&apos;s output goes to the arsenal instead of the
              open market.
            </p>
          </div>
          <div className="divide-y divide-card-border">
            {pending.map((c) => (
              <div key={c._id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-foreground">
                      {c.countryId} · {c.lotsOrdered.toLocaleString("en-US")} lots of {c.component}
                    </div>
                    <div className="text-[11px] text-muted">
                      at {c.plantLabel}
                      {" · "}
                      {formatAmount(c.pricePerLot)} per lot on delivery · worth{" "}
                      {formatAmount(c.pricePerLot * c.lotsOrdered)} in full
                      {c.projectedLotsPerTurn > 0 && (
                        <>
                          {" "}
                          · about{" "}
                          {Math.ceil(c.lotsOrdered / c.projectedLotsPerTurn).toLocaleString(
                            "en-US"
                          )}{" "}
                          turns at current output
                        </>
                      )}
                    </div>
                  </div>
                  {isCeo && (
                    <div className="flex gap-2">
                      <button
                        disabled={busyId === c._id}
                        onClick={() => respond(c._id, "accept")}
                        className="rounded-lg border border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_15%,transparent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--success)] disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        disabled={busyId === c._id}
                        onClick={() => respond(c._id, "decline")}
                        className="rounded-lg border border-card-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
                {c.projectedLotsPerTurn === 0 && (
                  <p className="mt-1.5 text-[11px] text-[var(--error)]">
                    This plant is currently producing nothing, so accepting would not start
                    deliveries until its output recovers.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">Delivery grade</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            The best quality this corporation can currently build, set by the technology decades its
            research has reached. Governments receive materiel at this grade — improving it raises
            the value of everything you deliver.
          </p>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-foreground">{GRADE_LABEL[grade]}</span>
            <div className="flex flex-1 gap-1">
              {[1, 2, 3].map((step) => (
                <div
                  key={step}
                  className="h-1.5 flex-1 rounded-full"
                  style={{ background: step <= grade ? "var(--gov)" : "var(--card-muted)" }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">Order book</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Every order this corporation has been offered. Each pays per lot on delivery — nothing
            is paid up front, and a plant re-tooled off its contracted component stops earning.
          </p>
        </div>
        {contracts.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted">
            {isCeo
              ? "No government has offered this corporation a contract. Defence ministers award them from their own cabinet office; a plant running a line that builds materiel is what makes you eligible."
              : "This corporation holds no government procurement contracts."}
          </div>
        ) : (
          <div className="divide-y divide-card-border">
            {contracts.map((c) => {
              const pct = c.lotsOrdered > 0 ? (c.lotsDelivered / c.lotsOrdered) * 100 : 0;
              const remaining = Math.max(0, c.lotsOrdered - c.lotsDelivered);
              // A live contract with no output is the one actionable failure here: the plant
              // has been re-tooled off the component, or its production has collapsed.
              const stalled = c.status === "active" && c.projectedLotsPerTurn === 0;
              return (
                <div key={c._id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-foreground">
                          {c.countryId} · {c.component}
                          {c.plantLabel ? ` · ${c.plantLabel}` : ""}
                        </span>
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            STATUS_TONE[c.status] ?? "border-card-border text-muted"
                          }`}
                        >
                          {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted">
                        {formatAmount(c.pricePerLot)} per lot
                        {c.unitProductionCost != null ? (
                          <>
                            {" "}
                            · costs {formatAmount(c.unitProductionCost)} to build · margin{" "}
                            <span
                              className={
                                c.pricePerLot - c.unitProductionCost >= 0
                                  ? "text-[var(--success)]"
                                  : "text-[var(--error)]"
                              }
                            >
                              {formatAmount(c.pricePerLot - c.unitProductionCost)}
                            </span>{" "}
                            per lot
                          </>
                        ) : (
                          <> · build cost unknown: the certified plant is gone</>
                        )}
                      </div>
                      <div className="text-[11px] text-muted">
                        paid {formatAmount(c.amountPaid)} · build cost{" "}
                        {formatAmount(c.productionCostPaid)}
                        {c.encumberedAmount > 0 &&
                          ` · ${formatAmount(c.encumberedAmount)} committed by the buyer`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-[12px] text-foreground">
                        {c.lotsDelivered.toLocaleString("en-US")} /{" "}
                        {c.lotsOrdered.toLocaleString("en-US")}
                      </div>
                      <div className="text-[11px] text-muted">
                        {c.status === "active"
                          ? `${remaining.toLocaleString("en-US")} outstanding · ${formatRate(c.projectedLotsPerTurn)}/turn`
                          : c.status === "pending"
                            ? "awaiting your answer"
                            : `${Math.round(pct)}% delivered`}
                      </div>
                      {(c.lotsBuiltNotDelivered > 0 || c.partialLot > 0) && (
                        <div className="text-[11px] text-[var(--warning)]">
                          {c.lotsBuiltNotDelivered.toLocaleString("en-US")} built and waiting
                          {c.partialLot > 0 && ` · ${(c.partialLot * 100).toFixed(0)}% of another`}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-card-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, pct)}%`, background: "var(--gov)" }}
                    />
                  </div>
                  {c.carryReasonText && (
                    <p className="mt-1.5 text-[11px] text-[var(--warning)]">{c.carryReasonText}</p>
                  )}
                  {c.selfDealing && (
                    <p className="mt-1.5 text-[11px] text-[var(--error)]">
                      Declared interest: {c.selfDealing.ministerName ?? "the awarding minister"}{" "}
                      {c.selfDealing.basis === "owner"
                        ? "owns this corporation"
                        : `holds ${(c.selfDealing.stakeShare * 100).toFixed(1)}% of it`}
                      . This award is on the public record.
                    </p>
                  )}
                  {c.termination && (
                    <p className="mt-1.5 text-[11px] text-[var(--warning)]">
                      {c.termination.basis === "withdrawal"
                        ? `Offer withdrawn by ${c.termination.ministerName ?? "the minister"} before you answered it.`
                        : c.termination.basis === "cause"
                          ? `Terminated for cause on ${c.termination.lotsCancelled.toLocaleString("en-US")} undelivered lots. The plant had stopped delivering, so no break fee was owed.`
                          : `Terminated by ${c.termination.ministerName ?? "the minister"} on ${c.termination.lotsCancelled.toLocaleString("en-US")} undelivered lots. You were paid ${formatAmount(c.termination.fee)} in break fees.`}
                    </p>
                  )}
                  {isCeo && (c.status === "active" || c.status === "pending") && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-muted">Production lines</span>
                      {Array.from({ length: c.totalFactories }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          disabled={busyId === c._id || n === c.assignedFactories}
                          onClick={() => setFactories(c._id, n)}
                          className={`rounded-md border px-2 py-0.5 text-[11px] disabled:opacity-60 ${
                            n === c.assignedFactories
                              ? "border-[color-mix(in_srgb,var(--gov)_45%,transparent)] text-gov-soft"
                              : "border-card-border text-muted hover:text-foreground"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                      <span className="text-[11px] text-muted">
                        of {c.totalFactories} lines at {c.plantLabel}. More lines use more of this
                        plant; they do not add plants, and the price per lot does not change.
                      </span>
                    </div>
                  )}
                  {stalled && (
                    <p className="mt-1.5 text-[11px] text-[var(--error)]">
                      Delivering nothing. This plant is either re-tooled off {c.component} or
                      producing no output — the order will not advance until that changes.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-card px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="tabular mt-0.5 text-[15px] font-semibold text-foreground">{value}</div>
    </div>
  );
}
