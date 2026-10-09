"use client";

import { useState } from "react";
import Link from "next/link";
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
import { SmallButton, TableScroll, Td, Th } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";
import { apiErrorText } from "@/lib/errors/catalog";

/** Rating tone: investment grade reads neutral, junk warns, CCC is the danger. */
const BAND_TONE: Record<CreditBandId, string> = {
  AAA: "text-foreground",
  AA: "text-foreground",
  A: "text-foreground",
  BBB: "text-foreground",
  BB: "text-warning",
  B: "text-warning",
  CCC: "text-error",
};

const STATUS_TONE: Record<string, string> = {
  current: "text-success",
  pending: "text-foreground",
  arrears: "text-warning",
  defaulted: "text-error",
  rejected: "text-error",
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
    <div className="space-y-1">
      <p className="flex flex-wrap gap-x-5 gap-y-1 py-1 text-xs text-muted">
        <span>
          Household book{" "}
          <span className="font-mono font-medium tabular-nums text-foreground">
            {formatBankMoney(book.total, currency)}
          </span>
        </span>
        <span>
          Blended rate{" "}
          <span className="font-mono tabular-nums text-foreground">
            {book.blendedRatePercent === null ? "n/a" : `${book.blendedRatePercent.toFixed(2)}%`}
          </span>
        </span>
        <span>
          Expected loss{" "}
          <span className="font-mono tabular-nums text-foreground">
            {book.blendedExpectedDefaultPercent === null
              ? "n/a"
              : `${book.blendedExpectedDefaultPercent.toFixed(2)}%`}
          </span>
        </span>
      </p>
      <TableScroll>
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <Th>Rating</Th>
              <Th align="right">Balance</Th>
              <Th align="right">Target</Th>
              <Th>Share of book</Th>
              <Th align="right">Rate</Th>
              <Th align="right">Expected default</Th>
            </tr>
          </thead>
          <tbody>
            {book.rows.map((row) => (
              <tr key={row.band} className={row.open ? "" : "opacity-60"}>
                <Td>
                  <span className={`font-mono font-medium ${BAND_TONE[row.band]}`}>{row.band}</span>
                  {!row.open && <span className="ml-2 text-[11px] text-muted">closed</span>}
                  {row.isLegacy && (
                    <span
                      className="ml-2 text-[11px] text-muted"
                      title="Originated before the book was split by rating. Runs off at its original rate."
                    >
                      legacy
                    </span>
                  )}
                </Td>
                <Td align="right">
                  {row.outstanding > 0 ? formatBankMoney(row.outstanding, currency) : ""}
                </Td>
                <Td
                  align="right"
                  className="text-muted"
                  title={
                    row.open
                      ? "Outstanding this band is building toward under the current stance"
                      : "Closed bands run off toward zero instead of being topped up"
                  }
                >
                  {row.target === null || row.target === undefined
                    ? ""
                    : row.target > 0
                      ? formatBankMoney(row.target, currency)
                      : "run off"}
                </Td>
                <Td numeric={false} className="w-1/4">
                  <div className="h-1.5 w-full overflow-hidden rounded-sm bg-card-border/60">
                    <div
                      className="h-full bg-foreground/60"
                      style={{ width: `${(row.outstanding / max) * 100}%` }}
                    />
                  </div>
                </Td>
                <Td align="right">
                  {row.ratePercent === null ? "" : `${row.ratePercent.toFixed(2)}%`}
                </Td>
                <Td align="right" className="text-muted">
                  {row.expectedDefaultRatePercent.toFixed(2)}%
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
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
        showToast(apiErrorText(json, "Could not set the lending profile"), "error");
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
    <div className="space-y-1">
      <h3 className="flex items-baseline gap-2 border-b border-card-border pb-1 text-xs font-medium text-foreground">
        Lending stance
        <span className="font-normal text-muted">CEO control</span>
      </h3>
      <p className="py-1 text-xs text-muted">
        Sets which ratings the bank will lend to from the next turn. Loans already on the book keep
        their rate and rating. Both directions move slowly: open bands build at up to{" "}
        {MAX_NPC_FLOW_PER_TURN_FRACTION * 100}% of target per turn and closed bands run off at the
        same pace, so a large mix shift takes {turnsToHours(48)} or more. The Target column shows
        where each band is heading under the current stance.
      </p>
      <TableScroll>
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <Th>Stance</Th>
              <Th>Lends to</Th>
              <Th align="right">Target book</Th>
              <Th align="right">Earns / turn</Th>
              <Th align="right">Loses / turn</Th>
              <Th align="right">Gets there in</Th>
            </tr>
          </thead>
          <tbody>
            {LENDING_PROFILES.map((profile) => {
              const active = profile.id === current;
              const preview = stancePreview?.find((s) => s.profile === profile.id);
              return (
                <tr key={profile.id} className={active ? "bg-card-elevated" : undefined}>
                  <Td wrap>
                    <button
                      type="button"
                      disabled={!canMutate || busy}
                      onClick={() => void save(profile.id)}
                      aria-pressed={active}
                      title={profile.blurb}
                      className={`text-left disabled:cursor-not-allowed ${
                        active
                          ? "font-medium text-foreground"
                          : "text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground disabled:no-underline disabled:opacity-60"
                      }`}
                    >
                      {profile.label}
                    </button>
                    {active && <span className="ml-1.5 text-[11px] text-muted">current</span>}
                  </Td>
                  <Td className="font-mono text-muted">to {profile.floorBand}</Td>
                  <Td align="right">
                    {preview ? formatBankMoney(preview.fundingTied, currency) : ""}
                  </Td>
                  <Td align="right">
                    {preview ? formatBankMoney(preview.expectedReturnPerTurn, currency) : ""}
                  </Td>
                  <Td align="right" className="text-muted">
                    {preview ? formatBankMoney(preview.expectedLossPerTurn, currency) : ""}
                  </Td>
                  <Td align="right" className="text-muted">
                    {preview ? turnsToHours(preview.turnsToTarget) : ""}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
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
        showToast(apiErrorText(json, "Could not update the loan"), "error");
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
    <BankPanel kind="monitor" title="Loan book">
      <div className="space-y-5 pt-1">
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
        <div className="space-y-1">
          <h3 className="border-b border-card-border pb-1 text-xs font-medium text-foreground">
            Player loans
          </h3>
          {named.length === 0 ? (
            <p className="py-1 text-xs text-muted">
              No player loans. Named character and corporation loans appear here.
            </p>
          ) : (
            <TableScroll>
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr>
                    <Th>Borrower</Th>
                    <Th align="right">Principal</Th>
                    <Th align="right">Outstanding</Th>
                    <Th align="right">Rate</Th>
                    <Th>Term</Th>
                    <Th>Status</Th>
                    {showActions && <Th align="right">Decision</Th>}
                  </tr>
                </thead>
                <tbody>
                  {named.map((loan) => (
                    <tr key={loan.id}>
                      <Td>
                        {loan.borrower ? (
                          <Link
                            href={partyHref(
                              loan.borrowerType === "character" ? "character" : "corporation",
                              loan.borrower
                            )}
                            className="text-foreground hover:underline"
                          >
                            {loan.borrower.name}
                          </Link>
                        ) : (
                          <span className="text-muted">Unknown borrower</span>
                        )}
                        <span className="ml-1.5 text-[11px] text-muted">{loan.borrowerType}</span>
                      </Td>
                      <Td align="right">{formatBankMoney(loan.principal, currency)}</Td>
                      <Td align="right">{formatBankMoney(loan.outstanding, currency)}</Td>
                      <Td align="right">{formatRatePercent(loan.ratePercent)}</Td>
                      <Td
                        className="font-mono text-muted"
                        title={`Term runs ${turnsToHours(loan.termTurns)} from origination`}
                      >
                        T{loan.originatedTurn}, {loan.termTurns}t
                      </Td>
                      <Td className={STATUS_TONE[loan.status] ?? "text-muted"}>{loan.status}</Td>
                      {showActions && (
                        <Td align="right" numeric={false}>
                          {loan.status === "pending" ? (
                            <span className="inline-flex gap-1.5">
                              <SmallButton
                                tone="primary"
                                disabled={decidingId !== null}
                                onClick={() => void decide(loan.id, "accept")}
                              >
                                Approve
                              </SmallButton>
                              <SmallButton
                                tone="danger"
                                disabled={decidingId !== null}
                                onClick={() => void decide(loan.id, "reject")}
                              >
                                Decline
                              </SmallButton>
                            </span>
                          ) : null}
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      </div>
    </BankPanel>
  );
}
