"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";

interface Props {
  countryCode: string;
  canAct: boolean;
  onUpdate: () => void;
}

/**
 * Treasury Secretary (or country equivalent) action panel for transferring
 * federal surplus into the Central Bank's FX reserve pool. Rendered on the
 * finance-minister cabinet office page.
 */
export function FxReserveTransferPanel({ countryCode, canAct, onUpdate }: Props) {
  const countryId = countryCode.toUpperCase() as CountryId;
  const sym = CURRENCY_SYMBOLS[COUNTRY_CURRENCY_MAP[countryId]] ?? "$";
  const [amount, setAmount] = useState<string>("");
  const [justification, setJustification] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const parsedAmount = parseFloat(amount);
  const valid = !isNaN(parsedAmount) && parsedAmount > 0;

  async function submit() {
    if (!valid || !canAct) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/cabinet/treasury-transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsedAmount,
          justification: justification || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Transfer failed." });
      } else {
        setFeedback({
          type: "success",
          message: `Transferred ${sym}${Math.round(json.transferred).toLocaleString("en-US")} to FX reserves.`,
        });
        setAmount("");
        setJustification("");
        onUpdate();
      }
    } catch (e) {
      setFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Transfer failed.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">FX Reserve Transfer</h2>
      <p className="mb-4 text-sm text-muted">
        Move funds from the federal surplus to the Central Bank&apos;s FX reserve pool. Capped at
        0.5% of annual revenue per turn. One transfer per turn.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col text-sm">
          Amount ({sym})
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded border border-card-border bg-card-elevated px-2 py-1 font-mono"
            disabled={!canAct || submitting}
          />
        </label>
        <label className="flex flex-col text-sm">
          Justification (optional, 200 chars)
          <input
            type="text"
            maxLength={200}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            className="rounded border border-card-border bg-card-elevated px-2 py-1"
            disabled={!canAct || submitting}
          />
        </label>
      </div>

      <div className="mt-4">
        <Button onClick={submit} disabled={!valid || !canAct || submitting}>
          {submitting ? "Transferring…" : "Transfer to FX Reserve"}
        </Button>
      </div>

      {feedback && (
        <p
          className={`mt-3 text-sm ${
            feedback.type === "success" ? "text-green-400" : "text-red-400"
          }`}
        >
          {feedback.message}
        </p>
      )}
    </section>
  );
}
