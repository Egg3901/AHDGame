"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDetail } from "../CorporationPageTypes";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import {
  ESCROW_WITHDRAW_COOLDOWN_TURNS,
  shouldWarnEscrowFunding,
} from "@/lib/corporations/escrowFunding";

// ── Share Buyback & Escrow Panel ─────────────────────────────────────────────

interface ShareBuybackEscrowPanelProps {
  corpId: string;
  corporation: CorporationDetail;
  currentTurn: number;
  editShareBuybackMode: "instant" | "escrow";
  setEditShareBuybackMode: (val: "instant" | "escrow") => void;
  editEscrowFundingPerTurn: string;
  setEditEscrowFundingPerTurn: (val: string) => void;
  saving: boolean;
  onSaveSettings: () => void;
  onRefresh: () => void;
}

export function ShareBuybackEscrowPanel({
  corpId,
  corporation,
  currentTurn,
  editShareBuybackMode,
  setEditShareBuybackMode,
  editEscrowFundingPerTurn,
  setEditEscrowFundingPerTurn,
  saving,
  onSaveSettings,
  onRefresh,
}: ShareBuybackEscrowPanelProps) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const sym = liquidCode ? (CURRENCY_SYMBOLS[liquidCode] ?? "$") : "$";

  const escrowBalance = corporation.shareEscrowBalance ?? 0;
  const isEscrowMode = editShareBuybackMode === "escrow";
  const managedMarketActive = corporation.equityMarketPoolActive === true;

  const recentNetIncome = corporation.recentNetIncome ?? 0;
  const showFundingWarning =
    isEscrowMode &&
    shouldWarnEscrowFunding({
      fundingPerTurn: Number(editEscrowFundingPerTurn) || 0,
      recentNetIncome,
    });

  // Withdrawal: corp-local 1:1 move escrow → treasury, capped at the positive
  // balance and gated to once per ESCROW_WITHDRAW_COOLDOWN_TURNS.
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawSuccess, setWithdrawSuccess] = useState("");

  const lastWithdrawalTurn = corporation.lastEscrowWithdrawalTurn;
  const turnsSinceWithdrawal =
    lastWithdrawalTurn != null ? currentTurn - lastWithdrawalTurn : Infinity;
  const cooldownRemaining =
    lastWithdrawalTurn != null
      ? Math.max(0, ESCROW_WITHDRAW_COOLDOWN_TURNS - turnsSinceWithdrawal)
      : 0;
  const onCooldown = cooldownRemaining > 0;
  const canWithdraw = escrowBalance > 0 && !onCooldown;

  const fmtLocal = (v: number) =>
    liquidCode ? formatAmount(toInternalFrom(v, liquidCode), liquidCode) : formatAmount(v);

  async function handleWithdraw() {
    const parsed = Number(withdrawAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setWithdrawError("Enter a valid positive amount.");
      return;
    }
    if (parsed > escrowBalance) {
      setWithdrawError(
        `Can withdraw at most ${fmtLocal(escrowBalance)} (cannot make escrow negative).`
      );
      return;
    }
    setWithdrawing(true);
    setWithdrawError("");
    setWithdrawSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/escrow-withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parsed }),
      });
      const data = await res.json();
      if (res.ok) {
        setWithdrawSuccess(`${fmtLocal(parsed)} moved to treasury.`);
        setWithdrawAmount("");
        onRefresh();
      } else {
        setWithdrawError(data.error || "Withdrawal failed.");
      }
    } catch {
      setWithdrawError("Network error.");
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="border-b border-card-border bg-background/60 px-6 py-4">
        <h2 className="text-lg font-bold text-foreground">Equity Market Liquidity</h2>
        <p className="text-xs text-muted mt-0.5">
          {managedMarketActive
            ? "At-market trades settle against the finite currency market pool. Your corporation no longer has to bankroll its own buybacks."
            : "Choose whether share sells settle from treasury or the legacy corporation escrow."}
        </p>
      </div>

      <div className="px-6 py-4 space-y-4">
        {managedMarketActive && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            The market pool quotes a live bid and ask, uses purchases and public-float dividends to
            replenish cash, and limits immediate sales to its displayed bid depth.
          </div>
        )}

        {/* Mode toggle */}
        {!managedMarketActive && (
          <div className="flex items-center gap-1 rounded-lg bg-card-elevated p-1 w-fit border border-card-border">
            {(
              [
                { key: "instant", label: "Instant Buyback" },
                { key: "escrow", label: "Escrow" },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setEditShareBuybackMode(m.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  editShareBuybackMode === m.key
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Current escrow balance */}
        {(!managedMarketActive || escrowBalance !== 0) && (
          <div className="flex items-center justify-between rounded-lg border border-card-border bg-background/60 px-4 py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Current escrow
              </div>
              <div className="text-[10px] text-muted mt-0.5">
                {escrowBalance >= 0
                  ? "Reserve (counts as a corporate asset)"
                  : "Debt (lowers valuation)"}
              </div>
            </div>
            <span
              className={`text-lg font-bold tabular-nums ${
                escrowBalance >= 0 ? "text-success" : "text-error"
              }`}
            >
              {escrowBalance < 0 ? "−" : ""}
              {fmtLocal(Math.abs(escrowBalance))}
            </span>
          </div>
        )}

        {/* Dissolution / buyout settlement explainer */}
        {!managedMarketActive && (
          <p className="text-[10px] text-muted leading-relaxed">
            On dissolution or buyout the escrow settles before any shareholder payout. A{" "}
            <span className="text-success">positive</span> balance returns to liquid capital and is
            distributed with the rest of the payout. A <span className="text-error">negative</span>{" "}
            balance (a buyback debt) is covered from the corporation&apos;s assets first. If the
            debt is larger than what the corp has, the shortfall is borne by shareholders (there is
            no clawback from players who already sold into the escrow).
          </p>
        )}

        {/* Per-turn funding */}
        {!managedMarketActive && (
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Auto-fund per turn</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted">{sym}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={editEscrowFundingPerTurn}
                  onChange={(e) => setEditEscrowFundingPerTurn(e.target.value)}
                  disabled={!isEscrowMode}
                  placeholder="0"
                  className="w-40 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-sm text-right tabular-nums font-medium focus:border-primary focus:outline-none disabled:opacity-50"
                />
                <span className="text-xs text-muted">/turn</span>
              </div>
            </div>
            <p className="text-[10px] text-muted mt-1">
              {isEscrowMode
                ? "Moved from treasury into escrow each turn (capped at available treasury) to keep the desk funded."
                : "Available in Escrow mode."}
            </p>
            {showFundingWarning && (
              <p className="text-[11px] text-warning mt-1.5 leading-snug">
                ⚠️ This exceeds your recent net income (~{fmtLocal(recentNetIncome)}/turn). The desk
                will sweep your entire treasury into escrow every turn, leaving liquid capital at 0.
                Lower this or use Escrow Withdraw to recover cash.
              </p>
            )}
          </div>
        )}

        {!managedMarketActive && (
          <div>
            <button
              type="button"
              onClick={onSaveSettings}
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Buyback Settings"}
            </button>
          </div>
        )}

        {/* Withdraw to treasury */}
        {(!managedMarketActive || escrowBalance > 0) && (
          <div className="border-t border-card-border pt-3 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Withdraw to treasury
            </div>
            <p className="text-[10px] text-muted">
              Move a positive escrow balance back into liquid capital. Once every{" "}
              {ESCROW_WITHDRAW_COOLDOWN_TURNS} turns; cannot push escrow below zero.
            </p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">
                  {sym}
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  disabled={!canWithdraw}
                  placeholder="0"
                  className="w-full rounded-lg border border-card-border bg-background pl-7 pr-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={handleWithdraw}
                disabled={
                  withdrawing || !canWithdraw || !withdrawAmount || Number(withdrawAmount) <= 0
                }
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
              >
                {withdrawing ? "Withdrawing…" : "Withdraw"}
              </button>
            </div>
            {escrowBalance <= 0 && (
              <p className="text-[10px] text-muted">No positive escrow balance to withdraw.</p>
            )}
            {onCooldown && (
              <p className="text-[10px] text-warning">
                Available again in {cooldownRemaining} turns.
              </p>
            )}
            {withdrawError && (
              <div className="rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
                {withdrawError}
              </div>
            )}
            {withdrawSuccess && (
              <div className="rounded-lg border border-success/30 bg-success/10 p-2 text-xs text-success">
                {withdrawSuccess}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
