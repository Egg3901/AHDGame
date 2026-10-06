"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDetail } from "../CorporationPageTypes";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { InlineStatus, SmallButton } from "../dense/DenseKit";

interface CapitalInjectionPanelProps {
  corpId: string;
  corporation: CorporationDetail;
  /** Reload the corp after a successful injection so the treasury figure moves. */
  onRefresh: () => void;
}

/** Private corps only: move personal cash straight into the treasury. */
export function CapitalInjectionPanel({
  corpId,
  corporation,
  onRefresh,
}: CapitalInjectionPanelProps) {
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
        onRefresh();
      } else {
        setError(apiErrorText(data, "Injection failed."));
      }
    } catch {
      setError("Network error.");
    } finally {
      setInjecting(false);
    }
  }

  const sym = liquidCode ? (CURRENCY_SYMBOLS[liquidCode] ?? "$") : "$";

  return (
    <div className="space-y-1.5 py-1">
      <p className="text-xs text-muted">
        Transfer personal cash into the treasury. Private corporations only.
      </p>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted">{sym}</span>
        <input
          type="number"
          min={1}
          step={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          aria-label="Capital injection amount"
          className="h-7 min-w-0 flex-1 rounded-md border border-card-border bg-background px-2 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none"
        />
        <SmallButton
          tone="primary"
          onClick={handleInject}
          disabled={injecting || !amount || Number(amount) <= 0}
        >
          {injecting ? "Injecting" : "Inject"}
        </SmallButton>
      </div>
      <InlineStatus message={error} tone="error" />
      <InlineStatus message={success} tone="success" />
    </div>
  );
}
