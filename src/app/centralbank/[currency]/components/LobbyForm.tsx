"use client";

import type { CurrencyCode } from "@/lib/constants/currencies";
import { CENTRAL_BANK_LOBBY_MIN_AMOUNT } from "@/lib/constants/centralBankLobby";
import { Button } from "@/components/ui";
import { formatNativeCurrency } from "./centralBankUtils";

export function LobbyForm({
  targetName,
  amount,
  setAmount,
  lobbyCurrency,
  lobbyLiquid,
  homeCurrency,
  homeLiquid,
  forexEnabled,
  autoConvertEnabled,
  loading,
  error,
  onSubmit,
  onCancel,
}: {
  targetName: string;
  amount: number;
  setAmount: (n: number) => void;
  lobbyCurrency: CurrencyCode;
  lobbyLiquid: number;
  homeCurrency: CurrencyCode;
  homeLiquid: number;
  forexEnabled: boolean;
  autoConvertEnabled: boolean;
  loading: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const minAmt = CENTRAL_BANK_LOBBY_MIN_AMOUNT;
  const maxAmt = Math.floor(
    forexEnabled && autoConvertEnabled ? lobbyLiquid + homeLiquid * 0.95 : lobbyLiquid
  );
  const canPay = lobbyLiquid >= amount || (forexEnabled && autoConvertEnabled);
  const effectiveMax = Math.max(minAmt, maxAmt);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(value)) {
      setAmount(Math.max(minAmt, value));
    }
  };

  const quickFill = (pct: number) => {
    setAmount(Math.floor(lobbyLiquid * pct));
  };

  return (
    <div className="rounded-lg border border-card-border/50 bg-card-muted p-3 space-y-3">
      <p className="text-xs text-muted italic">
        Your contribution will be spent on behalf of{" "}
        <span className="font-medium text-foreground">{targetName}</span>.
      </p>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted">
          Contribution amount ({lobbyCurrency})
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
            {lobbyCurrency === "USD"
              ? "$"
              : lobbyCurrency === "GBP"
                ? "£"
                : lobbyCurrency === "JPY"
                  ? "¥"
                  : lobbyCurrency}
          </span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount.toLocaleString("en-US")}
            onChange={handleInputChange}
            className="w-full rounded-lg border border-card-border bg-background pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-primary/50 focus:outline-none tabular-nums"
            placeholder="0"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[0.25, 0.5, 0.75, 1.0].map((pct) => (
          <button
            key={pct}
            type="button"
            onClick={() => quickFill(pct)}
            disabled={loading || lobbyLiquid < 1}
            className="flex-1 min-w-[60px] rounded-md border border-card-border bg-card px-2 py-1.5 text-xs font-medium text-foreground hover:bg-card-elevated disabled:opacity-40"
          >
            {pct === 1.0 ? "Max" : `${pct * 100}%`}
          </button>
        ))}
      </div>

      <div className="space-y-1 text-xs text-muted">
        <p>
          <span className="font-medium text-foreground">{lobbyCurrency}</span> wallet (this bank):{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatNativeCurrency(lobbyLiquid, lobbyCurrency)}
          </span>
        </p>
        {forexEnabled && (
          <p>
            Home ({homeCurrency}) wallet:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatNativeCurrency(homeLiquid, homeCurrency)}
            </span>
            {autoConvertEnabled ? (
              <span className="text-muted">
                {" "}
                — auto-convert will top up {lobbyCurrency} if needed
              </span>
            ) : (
              <span className="text-warning"> — auto-convert off (exchange manually)</span>
            )}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={onSubmit}
          isLoading={loading}
          disabled={loading || !canPay || amount < minAmt || amount > effectiveMax}
        >
          Commit Funds
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
