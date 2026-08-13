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
import type { ConsolePayload } from "../types";
import { partyHref } from "../lib/helpers";

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
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
              <th className="px-4 py-3 font-semibold">Rating</th>
              <th className="px-4 py-3 font-semibold text-right">Balance</th>
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
  current,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  current: LendingProfileId;
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
      showToast(json.message ?? "Lending profile saved", "success");
      onChanged();
    } catch {
      showToast("Could not set the lending profile", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-1 text-sm font-semibold text-foreground">Lending stance</div>
      <p className="mb-3 text-xs text-muted">
        Sets which ratings the bank will lend to from the next turn. Loans already on the book keep
        their rate and rating.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {LENDING_PROFILES.map((profile) => {
          const active = profile.id === current;
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
  corporationId,
  canMutate,
  onChanged,
  showToast,
}: {
  loans: ConsolePayload["loans"];
  currency: CurrencyCode;
  householdBook: ConsolePayload["householdBook"];
  corporationId: string;
  canMutate: boolean;
  onChanged: () => void;
  showToast: (message: string, tone?: "success" | "error") => void;
}) {
  const named = loans.filter((l) => l.borrowerType !== "npcBulk");

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-foreground">Loan book</h3>
      {householdBook && <HouseholdBookTable book={householdBook} currency={currency} />}
      {householdBook && (
        <LendingProfilePicker
          corporationId={corporationId}
          current={householdBook.lendingProfile}
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
                  <td className="px-4 py-3 text-muted">
                    T{loan.originatedTurn} · {loan.termTurns}t
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      color={
                        loan.status === "current"
                          ? "success"
                          : loan.status === "arrears"
                            ? "warning"
                            : loan.status === "defaulted"
                              ? "error"
                              : "default"
                      }
                      variant="subtle"
                    >
                      {loan.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
