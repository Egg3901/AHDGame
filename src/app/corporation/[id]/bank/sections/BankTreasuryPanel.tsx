"use client";

import { useState } from "react";
import { Segmented } from "@/components/corporation/dense/DenseKit";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import { BankPanel } from "../components/BankSection";
import type { BankTreasuryOverview, BankTreasuryPosition } from "@/lib/banking/bankTreasury";
import type { ShowToast } from "../types";

export function BankTreasuryPanel({
  corporationId,
  overview,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  overview: BankTreasuryOverview;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [units, setUnits] = useState("1");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const currency = overview.currency;

  const toggleSweep = async (enabled: boolean) => {
    setBusyKey("sweep");
    try {
      const response = await fetch(`/api/corporations/${corporationId}/bank/treasury`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggleAutoSweep", enabled }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(result.error ?? "Could not update automatic bill purchases.", "error");
        return;
      }
      showToast(
        enabled ? "Automatic bill purchases enabled." : "Automatic bill purchases disabled.",
        "success"
      );
      await onChanged();
    } catch {
      showToast("Could not update automatic bill purchases.", "error");
    } finally {
      setBusyKey(null);
    }
  };

  const trade = async (position: BankTreasuryPosition, side: "buy" | "sell") => {
    const count = Number(units);
    if (!Number.isSafeInteger(count) || count <= 0) {
      showToast("Enter a positive whole number of bill units.", "error");
      return;
    }
    const key = `${side}:${position.bondId}`;
    setBusyKey(key);
    try {
      const response = await fetch(`/api/corporations/${corporationId}/bank/treasury`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "trade",
          side,
          bondId: position.bondId,
          units: count,
          requestId: crypto.randomUUID(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 202) {
        showToast(result.error ?? "The bill trade was refused.", "error");
        return;
      }
      showToast(
        result.status === "pending"
          ? "The trade is settling and will be recovered automatically."
          : `${side === "buy" ? "Bought" : "Sold"} ${result.units} bill units for ${formatBankMoney(result.amountLocal, currency)}.`,
        result.status === "pending" ? "info" : "success"
      );
      await onChanged();
    } catch {
      showToast(
        "Trade status is uncertain. Reload the console before submitting another order.",
        "error"
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <BankPanel
      kind="ceoControl"
      title="Short sovereign bills"
      actions={
        <Segmented
          ariaLabel="Automatic bill purchases"
          options={[
            { value: "off", label: "Manual" },
            { value: "on", label: "Auto-sweep" },
          ]}
          value={overview.autoSweep ? "on" : "off"}
          onChange={(value) => {
            if ((value === "on") !== overview.autoSweep) void toggleSweep(value === "on");
          }}
          disabled={!canMutate || busyKey !== null}
        />
      }
    >
      <div className="grid grid-cols-2 gap-2 py-2 text-xs sm:grid-cols-4">
        <div>
          <span className="text-muted">Vault cash</span>
          <div className="font-mono">{formatBankMoney(overview.cashReserves, currency)}</div>
        </div>
        <div>
          <span className="text-muted">Cash floor</span>
          <div className="font-mono">
            {formatBankMoney(overview.cashFloor.floorLocal, currency)}
          </div>
        </div>
        <div>
          <span className="text-muted">Spendable cash</span>
          <div className="font-mono">{formatBankMoney(overview.spendableCash, currency)}</div>
        </div>
        <div>
          <span className="text-muted">Bill mark</span>
          <div className="font-mono">{formatBankMoney(overview.markValueLocal, currency)}</div>
        </div>
      </div>
      <p className="pb-2 text-xs text-muted">
        The floor covers required reserves, the existing household withdrawal buffer, and next-turn
        interest. Bill marks use current pool bids; sale proceeds are limited to cash actually
        available in the pool.
      </p>
      <label className="mb-2 flex items-center gap-2 text-xs">
        Units per manual trade
        <input
          aria-label="Bill units per trade"
          className="w-28 rounded border border-card-border bg-background px-2 py-1 font-mono"
          inputMode="numeric"
          min="1"
          step="1"
          type="number"
          value={units}
          onChange={(event) => setUnits(event.target.value)}
          disabled={!canMutate || busyKey !== null}
        />
      </label>
      {overview.positions.length === 0 ? (
        <p className="py-2 text-xs text-muted">
          No same-currency sovereign bills are currently available.
        </p>
      ) : (
        <div className="divide-y divide-card-border">
          {overview.positions.map((position) => (
            <div
              key={position.bondId}
              className="grid gap-2 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div>
                <div className="font-medium">
                  {position.issuer} · matures in {position.remainingTurns} turns
                </div>
                <div className="text-muted">
                  Held {position.units} · bid {formatBankMoney(position.bidPerUnitLocal, currency)}{" "}
                  · ask {formatBankMoney(position.askPerUnitLocal, currency)} · sell depth{" "}
                  {position.executablePoolDepthUnits}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-card-border px-2 py-1 disabled:opacity-50"
                  disabled={!canMutate || busyKey !== null || !position.eligibleToBuy}
                  onClick={() => void trade(position, "buy")}
                >
                  Buy
                </button>
                <button
                  type="button"
                  className="rounded border border-card-border px-2 py-1 disabled:opacity-50"
                  disabled={
                    !canMutate ||
                    busyKey !== null ||
                    position.units <= 0 ||
                    position.executablePoolDepthUnits <= 0
                  }
                  onClick={() => void trade(position, "sell")}
                >
                  Sell
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </BankPanel>
  );
}
