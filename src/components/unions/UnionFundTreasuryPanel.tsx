"use client";

import { useState } from "react";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { formatLocalAmountFull } from "@/lib/utils/formatters";

interface UnionFundTreasuryPanelProps {
  unionId: string;
  /** Country the union operates in, used to label the amount with the local currency. */
  countryId: string;
  treasury: number;
  /** Only the union head may fund the treasury; everyone else sees the explainer only. */
  isHead: boolean;
  suspended: boolean;
  onFunded: () => void;
}

/**
 * Put personal money into the union treasury, and say plainly what the treasury
 * is for.
 *
 * Player ticket #1112 asked what the treasury is and how to get more of it, and
 * #1121 asked outright how to send money to a union while building one. Dues
 * were the only inflow, and they are charged on a membership the union has to
 * win first, so a fresh union sat at zero with no way to pay for the drive that
 * would earn it members. This is the bootstrap.
 */
export function UnionFundTreasuryPanel({
  unionId,
  countryId,
  treasury,
  isHead,
  suspended,
  onFunded,
}: UnionFundTreasuryPanelProps) {
  // Kept as a string so the field can be cleared while typing without snapping
  // back to the last committed number.
  const [amountDraft, setAmountDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const currency = (COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
    "USD") as CurrencyCode;
  /** Money reads as money: symbol and grouping, not a bare number with a code stuck on the end. */
  const money = (value: number) => formatLocalAmountFull(value, currency);
  const amount = Number(amountDraft);
  const amountValid = Number.isFinite(amount) && amount >= 1;

  async function handleFund() {
    setPending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/unions/${unionId}/fund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Math.floor(amount) }),
      });
      const data = await res.json();
      setResult({
        ok: res.ok,
        text: res.ok
          ? `Contributed ${money(Math.floor(amount))} to the treasury.`
          : (data.error ?? "The contribution failed."),
      });
      if (res.ok) {
        setAmountDraft("");
        onFunded();
      }
    } catch {
      setResult({ ok: false, text: "Network error. Nothing was spent." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-card-border pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Treasury</h3>
        <span className="text-xs text-muted tabular-nums">{money(treasury)}</span>
      </div>

      <p className="text-sm text-muted">
        The treasury is the union&apos;s own money. It comes in from dues every turn, and it pays
        for services, organizing drives and bargaining campaigns. A union with an empty treasury
        cannot act, so the president can back it out of their campaign funds to get it started.
      </p>

      {isHead && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="union-fund-amount"
              className="text-[11px] uppercase tracking-wider text-muted"
            >
              Contribute from campaign funds
            </label>
            <input
              id="union-fund-amount"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={amountDraft}
              onChange={(e) => setAmountDraft(e.target.value)}
              disabled={pending || suspended}
              placeholder="Amount"
              className="w-32 rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm tabular-nums disabled:opacity-50"
            />
            <button
              type="button"
              disabled={pending || suspended || !amountValid}
              onClick={handleFund}
              className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Fund Treasury"}
            </button>
          </div>
          {amountDraft !== "" && !amountValid && (
            <p className="text-[11px] text-muted">Enter a whole amount of at least 1.</p>
          )}
        </>
      )}

      {result && (
        <p
          role={result.ok ? "status" : "alert"}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            result.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          <span aria-hidden>{result.ok ? "✓" : "⚠"}</span>
          <span>{result.text}</span>
        </p>
      )}
    </div>
  );
}
