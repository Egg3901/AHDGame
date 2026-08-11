"use client";

import { useState } from "react";
import { Input } from "@/components/ui";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { parseMoneyAmountInput } from "@/lib/utils/parseMoneyAmountInput";
import { partyApiUrl } from "@/lib/urls";
import { getMessageStyle } from "@/lib/utils/formatters";
import { contrastTextColor } from "@/lib/utils/colorContrast";
import type { PartyData } from "./types";

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
          and waits for officer approval — Treasurer, Chair, or Vice-Chair. You can&apos;t approve
          your own request.
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
