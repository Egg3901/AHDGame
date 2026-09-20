"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { parseMoneyAmountInput } from "@/lib/utils/parseMoneyAmountInput";
import { partyApiUrl } from "@/lib/urls";
import { getMessageStyle } from "@/lib/utils/formatters";
import { contrastTextColor } from "@/lib/utils/colorContrast";
import type { PartyData } from "./types";
import type { CountryId } from "@/lib/constants/countries";
import {
  getEffectivePlayerPayoutCap,
  PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER,
} from "@/lib/treasury/payoutCapValues";

/**
 * Member-initiated Request Funds card. Any party member can request
 * campaign funds from the party treasury; the request goes to Pending
 * Transactions and requires 1 (single mode) or 2 (double mode)
 * approvals from officers, with no auto-approval from the requester.
 *
 * Visible to all party members. Sits below the Donate card and above
 * the Pending Transactions card in the Treasury tab.
 */
export function RequestFundsCard({
  party,
  countryCode,
  onRequested,
}: {
  party: PartyData;
  countryCode: string;
  onRequested?: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const partyCurrencyCode = COUNTRY_CURRENCY_MAP[party.countryId];
  const partySymbol = CURRENCY_SYMBOLS[partyCurrencyCode];
  // `seatedOfficers` comes from the server, counted off the raw seat ids.
  // Deriving it from `chair`/`viceChair`/`treasurer` here would be wrong:
  // those are null for a banned holder whose seat still counts.
  const seatedOfficers = party.seatedOfficers;
  const cap = getEffectivePlayerPayoutCap(party.countryId as CountryId, seatedOfficers);
  /**
   * What this member may still receive this turn. The flat cap alone
   * was misleading: most of it may already be spent, and the player
   * only found out when the request was refused.
   */
  const [remaining, setRemaining] = useState<number | null>(null);

  const loadAllowance = useCallback(
    async (isCancelled?: () => boolean) => {
      try {
        const res = await fetch(`${partyApiUrl(countryCode, party.id)}/treasury/payout-allowance`);
        if (!res.ok) return;
        const data = await res.json();
        if (isCancelled?.()) return;
        if (typeof data?.remaining === "number") setRemaining(data.remaining);
      } catch {
        // Non-critical: the card falls back to quoting the flat cap.
        // A server mid-rollout without this endpoint lands here too.
      }
    },
    [countryCode, party.id]
  );

  useEffect(() => {
    let cancelled = false;
    void loadAllowance(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadAllowance]);

  const handleSubmit = async () => {
    setMsg("");
    const parsedAmount = Math.round(parseMoneyAmountInput(amount));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setMsg("✗ Enter a valid amount");
      return;
    }
    if (parsedAmount < 1000) {
      setMsg(`✗ Minimum request is ${partySymbol}1,000`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${partyApiUrl(countryCode, party.id)}/treasury/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parsedAmount, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(`✗ ${data.error ?? "Request failed"}`);
        return;
      }
      setMsg(`✓ ${data.message ?? "Request submitted"}`);
      setAmount("");
      setNote("");
      onRequested?.();
      // An approved request lands against the same per-turn allowance,
      // so the figure above goes stale the moment one is queued.
      void loadAllowance();
    } catch {
      setMsg("✗ Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {msg && (
        <div className={`px-6 py-3 border-b border-card-border/40 text-sm ${getMessageStyle(msg)}`}>
          {msg}
        </div>
      )}
      <div className="px-6 py-5">
        <div className="flex items-center gap-2 mb-3">
          <svg
            className="h-4 w-4 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Request Funds
          </div>
        </div>
        <p className="text-[11px] text-muted/60 mb-3">
          Request campaign funds from the party treasury. Your request goes to Pending Transactions
          and waits for approval by an officer other than yourself: any of the Treasurer, Chair or
          Vice-Chair. You can receive up to {partySymbol}
          {cap.toLocaleString()} per turn from party funds in total, counting the national treasury,
          state parties and caucuses together, and nothing at all in the last two turns before a
          leadership election closes.{" "}
          {seatedOfficers >= 2
            ? `That ceiling is ${PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER} times the base one, because this party has two or more officers seated to sign payments off.`
            : `Seating a second officer would raise it to ${partySymbol}${(cap * PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER).toLocaleString()}.`}
        </p>
        <p className="text-[11px] mb-3 text-muted">
          {remaining == null ? (
            <>Checking how much you can still receive this turn...</>
          ) : remaining === 0 ? (
            <span className="text-error">
              You have already received your full {partySymbol}
              {cap.toLocaleString()} for this turn. A request now will not pay out until next turn.
            </span>
          ) : (
            <>
              You can still receive{" "}
              <span className="font-semibold text-foreground">
                {partySymbol}
                {remaining.toLocaleString()}
              </span>{" "}
              of your {partySymbol}
              {cap.toLocaleString()} this turn.
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-36 bg-background py-2 text-sm"
          />
          <Input
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 min-w-48 bg-background py-2 text-sm"
            maxLength={280}
          />
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: party.color, color: contrastTextColor(party.color) }}
          >
            {submitting ? "Requesting…" : "Request"}
          </button>
        </div>
        <div className="mt-1 text-xs text-muted">
          Min. {partySymbol}1,000 · Sent to your campaign funds on approval
        </div>
      </div>
    </div>
  );
}
