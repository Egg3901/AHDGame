"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDetail } from "../CorporationPageTypes";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";

// ── Capital Injection Panel ──────────────────────────────────────────────────

interface CapitalInjectionPanelProps {
  corpId: string;
  corporation: CorporationDetail;
}

export function CapitalInjectionPanel({ corpId, corporation }: CapitalInjectionPanelProps) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;

  const [amount, setAmount] = useState<string>("");
  const [injecting, setInjecting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleInject() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Enter a valid positive amount.");
      return;
    }

    setInjecting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/capital-injection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parsed }),
      });
      const data = await res.json();
      if (res.ok) {
        const added = liquidCode
          ? formatAmount(toInternalFrom(data.injectedAmount ?? parsed, liquidCode), liquidCode)
          : formatAmount(data.injectedAmount ?? parsed);
        setSuccess(`${added} injected into treasury.`);
        setAmount("");
      } else {
        setError(data.error || "Injection failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setInjecting(false);
    }
  }

  const sym = liquidCode ? (CURRENCY_SYMBOLS[liquidCode] ?? "$") : "$";

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Capital Injection</h3>
        <p className="text-xs text-muted mt-0.5">
          Transfer personal cash directly into this corporation&apos;s treasury. Available for
          private corporations only.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">
            {sym}
          </span>
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full rounded-lg border border-card-border bg-background pl-7 pr-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          onClick={handleInject}
          disabled={injecting || !amount || Number(amount) <= 0}
          className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
        >
          {injecting ? "Injecting…" : "Inject Capital"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-2 text-xs text-success">
          {success}
        </div>
      )}
    </div>
  );
}
