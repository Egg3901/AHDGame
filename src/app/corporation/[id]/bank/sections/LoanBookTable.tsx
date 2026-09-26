"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  LENDING_PROFILES,
  type CreditBandId,
  type LendingProfileId,
} from "@/lib/banking/creditBands";
import { MAX_NPC_FLOW_PER_TURN_FRACTION } from "@/lib/banking/rules/loans";
import type { ConsolePayload, OutlookPayload } from "../types";
import { partyHref, turnsToHours } from "../lib/helpers";
import { Eyebrow } from "../components/BankSection";

/** Colour ramp for the rating column: investment grade cools, junk warms. */
const BAND_TONE: Record<CreditBandId, string> = {
  AAA: "text-emerald-500",
  AA: "text-emerald-500",
  A: "text-teal-500",
  BBB: "text-sky-500",
  BB: "text-amber-500",
  B: "text-orange-500",
  CCC: "text-rose-500",
};

function HouseholdBookTable({
  book,
  currency,
}: {
  book: NonNullable<ConsolePayload["householdBook"]>;
  currency: CurrencyCode;
}) {
  const max = Math.max(...book.rows.map((r) => r.outstanding), 1);

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-card-border px-4 py-3">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-muted">Household book</span>
          <div className="font-mono text-lg tabular-nums text-foreground">
            {formatBankMoney(book.total, currency)}
          </div>
        </div>
        <div className="flex gap-6 text-right text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted">Blended rate</div>
            <div className="font-mono tabular-nums text-foreground">
              {book.blendedRatePercent === null ? "—" : `${book.blendedRatePercent.toFixed(2)}%`}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted">Expected loss</div>
            <div className="font-mono tabular-nums text-foreground">
              {book.blendedExpectedDefaultPercent === null
                ? "—"
                : `${book.blendedExpectedDefaultPercent.toFixed(2)}%`}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
              <th className="px-4 py-3 font-semibold">Rating</th>
              <th className="px-4 py-3 font-semibold text-right">Balance</th>
              <th className="px-4 py-3 font-semibold text-right">Target</th>
              <th className="px-4 py-3 font-semibold">Share of book</th>
              <th className="px-4 py-3 font-semibold text-right">Rate</th>
              <th className="px-4 py-3 font-semibold text-right">Exp. default</th>
            </tr>
          </thead>
          <tbody>
            {book.rows.map((row) => (
              <tr
                key={row.band}
                className={`border-b border-card-border/60 last:border-0 ${
                  row.open ? "" : "opacity-55"
                }`}
              >
                <td className="px-4 py-2.5">
                  <span className={`font-mono font-semibold ${BAND_TONE[row.band]}`}>
                    {row.band}
                  </span>
                  {!row.open && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">
                      closed
                    </span>
                  )}
                  {row.isLegacy && (
                    <span
                      className="ml-2 text-[10px] uppercase tracking-wide text-muted"
                      title="Originated before the book was split by rating. Runs off at its original rate."
                    >
                      legacy
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {row.outstanding > 0 ? formatBankMoney(row.outstanding, currency) : "—"}
                </td>
                <td
                  className="px-4 py-2.5 text-right font-mono tabular-nums text-muted"
                  title={
                    row.open
                      ? "Outstanding this band is building toward under the current stance"
                      : "Closed bands run off toward zero instead of being topped up"
                  }
                >
                  {row.target === null || row.target === undefined
                    ? "—"
                    : row.target > 0
                      ? formatBankMoney(row.target, currency)
                      : "run off"}
                </td>
                <td className="px-4 py-2.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-border/60">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(row.outstanding / max) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                  {row.ratePercent === null ? "—" : `${row.ratePercent.toFixed(2)}%`}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                  {row.expectedDefaultRatePercent.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LendingProfilePicker({
  corporationId,
  currency,
  current,
  stancePreview,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  current: LendingProfileId;
  /** Per-stance economics from the outlook: return, loss, funding, travel time. */
  stancePreview: OutlookPayload["stancePreview"] | null;
  canMutate: boolean;
  onChanged: () => void;
  showToast: (message: string, tone?: "success" | "error") => void;
}) {
  const [busy, setBusy] = useState(false);

  const save = async (profile: LendingProfileId) => {
    if (profile === current || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/lending-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Could not set the lending profile", "error");
        return;
      }
      const preview = stancePreview?.find((s) => s.profile === profile);
      showToast(
        preview
          ? `${profile === "conservative" ? "Conservative" : profile === "balanced" ? "Balanced" : "Aggressive"} stance saved: steers toward a ${formatBankMoney(preview.fundingTied, currency)} book, earning about ${formatBankMoney(preview.expectedReturnPerTurn, currency)} a turn against ${formatBankMoney(preview.expectedLossPerTurn, currency)} of expected losses, arriving in about ${turnsToHours(preview.turnsToTarget)}.`
          : (json.message ?? "Lending profile saved"),
        "success"
      );
      onChanged();
    } catch {
      showToast("Could not set the lending profile", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-card-border bg-card p-4">
      <Eyebrow kind="ceoControl" />
      <div className="mb-1 text-sm font-semibold text-foreground">Lending stance</div>
      <p className="mb-3 text-xs text-muted">
        Sets which ratings the bank will lend to from the next turn. Loans already on the book keep
        their rate and rating. Both directions move slowly: open bands build at up to{" "}
        {MAX_NPC_FLOW_PER_TURN_FRACTION * 100}% of target per turn and closed bands run off at the
        same pace, so a large mix shift takes {turnsToHours(48)} or more. The Target column shows
        where each band is heading under the current stance.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {LENDING_PROFILES.map((profile) => {
          const active = profile.id === current;
          const preview = stancePreview?.find((s) => s.profile === profile.id);
          return (
            <button
              key={profile.id}
              type="button"
              disabled={!canMutate || busy}
              onClick={() => void save(profile.id)}
              className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                active ? "border-accent bg-accent/10" : "border-card-border hover:border-accent/50"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-foreground">{profile.label}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
                  to {profile.floorBand}
                </span>
              </div>
              <p className="mt-1 text-xs leading-snug text-muted">{profile.blurb}</p>
              {preview && (
                <dl className="mt-2 space-y-0.5 text-[11px] text-muted">
                  <div className="flex justify-between gap-2">
                    <dt>Target book</dt>
                    <dd className="font-mono tabular-nums text-foreground">
                      {formatBankMoney(preview.fundingTied, currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Earns / turn</dt>
                    <dd className="font-mono tabular-nums text-foreground">
                      {formatBankMoney(preview.expectedReturnPerTurn, currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Loses / turn</dt>
                    <dd className="font-mono tabular-nums text-foreground">
                      {formatBankMoney(preview.expectedLossPerTurn, currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Gets there in</dt>
                    <dd className="font-mono tabular-nums text-foreground">
                      {turnsToHours(preview.turnsToTarget)}
                    </dd>
                  </div>
                </dl>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LoanBookTable({
  loans,
  currency,
  householdBook,
  stancePreview = null,
  corporationId,
  canMutate,
  onChanged,
  showToast,
}: {
  loans: ConsolePayload["loans"];
  currency: CurrencyCode;
  householdBook: ConsolePayload["householdBook"];
  stancePreview?: OutlookPayload["stancePreview"] | null;
  corporationId: string;
  canMutate: boolean;
  onChanged: () => void;
  showToast: (message: string, tone?: "success" | "error") => void;
}) {
  const named = loans.filter((l) => l.borrowerType !== "npcBulk");
  const hasPending = named.some((l) => l.status === "pending");
  const showActions = canMutate && hasPending;
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const decide = async (loanId: string, decision: "accept" | "reject") => {
    if (decidingId) return;
    setDecidingId(loanId);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/loans/${loanId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error ?? "Could not update the loan", "error");
        return;
      }
      const subject = loans.find((l) => l.id === loanId);
      const amount = subject ? formatBankMoney(subject.outstanding, currency) : null;
      showToast(
        decision === "accept"
          ? amount
            ? `Loan approved: ${amount} moves into the book and starts earning ${subject?.ratePercent.toFixed(2)}% next turn.`
            : "Loan approved: it funds next turn and starts earning interest."
          : "Loan declined: nothing leaves the vault.",
        "success"
      );
      onChanged();
    } catch {
      showToast("Could not update the loan", "error");
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <section className="space-y-3">
      <Eyebrow kind="monitor" />
      <h3 className="text-base font-semibold text-foreground">Loan book</h3>
      {householdBook && <HouseholdBookTable book={householdBook} currency={currency} />}
      {householdBook && (
        <LendingProfilePicker
          corporationId={corporationId}
          currency={currency}
          current={householdBook.lendingProfile}
          stancePreview={stancePreview}
          canMutate={canMutate}
          onChanged={onChanged}
          showToast={showToast}
        />
      )}
      {named.length === 0 ? (
        <EmptyState
          title="No player loans"
          description="Named character and corporation loans appear here."
        />
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-card-border bg-card">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
                <th className="px-4 py-3 font-semibold">Borrower</th>
                <th className="px-4 py-3 font-semibold text-right">Principal</th>
                <th className="px-4 py-3 font-semibold text-right">Outstanding</th>
                <th className="px-4 py-3 font-semibold text-right">Rate</th>
                <th className="px-4 py-3 font-semibold">Term</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                {showActions && <th className="px-4 py-3 font-semibold text-right">Decision</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {named.map((loan) => (
                <tr key={loan.id}>
                  <td className="px-4 py-3">
                    {loan.borrower ? (
                      <Link
                        href={partyHref(
                          loan.borrowerType === "character" ? "character" : "corporation",
                          loan.borrower
                        )}
                        className="font-medium text-primary hover:opacity-80"
                      >
                        {loan.borrower.name}
                      </Link>
                    ) : (
                      <span className="text-muted">Unknown borrower</span>
                    )}
                    <Badge color="default" variant="subtle" className="ml-2">
                      {loan.borrowerType}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(loan.principal, currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(loan.outstanding, currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatRatePercent(loan.ratePercent)}
                  </td>
                  <td
                    className="px-4 py-3 text-muted"
                    title={`Term runs ${turnsToHours(loan.termTurns)} from origination`}
                  >
                    T{loan.originatedTurn} · {loan.termTurns}t
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      color={
                        loan.status === "current"
                          ? "success"
                          : loan.status === "pending"
                            ? "info"
                            : loan.status === "arrears"
                              ? "warning"
                              : loan.status === "defaulted" || loan.status === "rejected"
                                ? "error"
                                : "default"
                      }
                      variant="subtle"
                    >
                      {loan.status}
                    </Badge>
                  </td>
                  {showActions && (
                    <td className="px-4 py-3 text-right">
                      {loan.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={decidingId !== null}
                            onClick={() => void decide(loan.id, "accept")}
                            className="rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={decidingId !== null}
                            onClick={() => void decide(loan.id, "reject")}
                            className="rounded-md border border-rose-500/40 px-2.5 py-1 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
