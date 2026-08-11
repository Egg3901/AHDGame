"use client";

import { useMemo, useState } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/contexts/ToastContext";
import { PlayerSelector } from "@/components/PlayerSelector";
import {
  FOREX_ACTIVE_CURRENCIES,
  CURRENCY_SYMBOLS,
  type CurrencyCode,
} from "@/lib/constants/currencies";

interface Recipient {
  id: string;
  name: string;
}

interface WireTransferCardProps {
  /** Legacy single-pool cash. Used when forex is off or no balances map provided. */
  cashOnHand: number;
  myCharacterId: string;
  countryId: string;
  /** Optional multi-currency wallet. When present, enables currency picker. */
  personalBalances?: Partial<Record<CurrencyCode, number>>;
  /** Sender's home currency. Required for the forex-aware picker. */
  homeCurrency?: CurrencyCode;
  /** Called with the new balance in the currency that was sent (pre-forex: cashOnHand). */
  onSuccess: (newBalance: number, currency: CurrencyCode) => void;
}

function formatBalance(amount: number, currency: CurrencyCode): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  if (currency === "JPY") return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
  return `${symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function WireTransferCard({
  cashOnHand,
  myCharacterId,
  countryId,
  personalBalances,
  homeCurrency,
  onSuccess,
}: WireTransferCardProps) {
  const { formatAmount } = useCurrency();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When forex is enabled we expose a currency picker; otherwise we fall back to the
  // legacy single-pool behavior (no picker, no currency param sent).
  const forexEnabled = !!personalBalances && !!homeCurrency;

  // Currencies with a non-zero balance, plus the home currency (always visible so the
  // player has a stable default even with an empty foreign bucket).
  const availableCurrencies = useMemo<CurrencyCode[]>(() => {
    if (!forexEnabled || !homeCurrency) return [];
    const currencies = FOREX_ACTIVE_CURRENCIES.filter((c) => {
      if (c === homeCurrency) return true;
      return (personalBalances?.[c] ?? 0) > 0;
    });
    // Ensure home is first for visual hierarchy
    return [homeCurrency, ...currencies.filter((c) => c !== homeCurrency)];
  }, [forexEnabled, homeCurrency, personalBalances]);

  const [currency, setCurrency] = useState<CurrencyCode | null>(
    forexEnabled && homeCurrency ? homeCurrency : null
  );

  const activeCurrency: CurrencyCode | null = currency ?? homeCurrency ?? null;
  const activeBalance =
    forexEnabled && activeCurrency ? (personalBalances?.[activeCurrency] ?? 0) : cashOnHand;
  const activeSymbol = activeCurrency ? (CURRENCY_SYMBOLS[activeCurrency] ?? "$") : "$";

  async function handleSend() {
    setError(null);
    const amt = parseInt(amount.replace(/[^0-9]/g, ""), 10);
    if (!selected) return setError("Choose a recipient.");
    if (!amt || amt <= 0) return setError("Enter a valid amount.");
    if (amt > activeBalance)
      return setError(
        activeCurrency ? `Insufficient ${activeCurrency} balance.` : "Insufficient cash on hand."
      );

    setSending(true);
    try {
      const body: { amount: number; currency?: CurrencyCode } = { amount: amt };
      if (forexEnabled && activeCurrency) body.currency = activeCurrency;

      trackAction("portfolio.wire", { recipientId: selected.id, amount: amt });
      const res = await fetch(`/api/characters/${selected.id}/wire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Transfer failed.");
      } else {
        const sentCurrency: CurrencyCode =
          data.currency ?? activeCurrency ?? ("USD" as CurrencyCode);
        const formatted = formatBalance(amt, sentCurrency);
        showToast(`Wired ${formatted} to ${selected.name}.`);
        onSuccess(data.remainingBalance ?? data.remainingCashOnHand, sentCurrency);
        setSelected(null);
        setAmount("");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 sm:px-6 border-b border-card-border bg-card-elevated">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground">Wire Transfer</h2>
            <p className="text-xs text-muted mt-0.5">
              {forexEnabled
                ? "Send personal funds to any politician, at home or abroad"
                : "Send personal funds to another politician in your country"}
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className="block text-[10px] uppercase tracking-widest text-muted font-bold">
              Available
            </span>
            <span className="text-lg font-bold tabular-nums text-foreground">
              {forexEnabled && activeCurrency
                ? formatBalance(activeBalance, activeCurrency)
                : formatAmount(activeBalance)}
            </span>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-4">
        {forexEnabled && availableCurrencies.length > 1 && (
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
              Currency
            </label>
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label="Transfer currency"
            >
              {availableCurrencies.map((c) => {
                const balance = personalBalances?.[c] ?? 0;
                const isActive = c === activeCurrency;
                const isHome = c === homeCurrency;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => {
                      setCurrency(c);
                      setError(null);
                    }}
                    className={`group flex flex-col items-start rounded-lg border px-3 py-2 transition-colors ${
                      isActive
                        ? "border-primary bg-primary/5"
                        : "border-card-border bg-background hover:bg-card-elevated"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`text-xs font-bold ${
                          isActive ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {c}
                      </span>
                      {isHome && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
                          Home
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted">
                      {formatBalance(balance, c)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            Recipient
          </label>
          <PlayerSelector
            onSelect={(c) => {
              setSelected({ id: c.id, name: c.name });
              setError(null);
            }}
            placeholder="Search by name…"
            excludeIds={[myCharacterId]}
            countryId={forexEnabled ? undefined : countryId}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            Amount
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none">
              {activeSymbol}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="0"
              className="w-full rounded-lg border border-card-border bg-background pl-7 pr-3 py-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
            />
          </div>
        </div>

        {error && <p className="text-xs text-error">{error}</p>}

        <button
          onClick={handleSend}
          disabled={sending || !selected || !amount}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {sending ? "Sending…" : "Send Wire"}
        </button>
      </div>
    </div>
  );
}
