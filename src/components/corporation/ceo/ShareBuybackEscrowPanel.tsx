"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDetail } from "../CorporationPageTypes";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import {
  ESCROW_WITHDRAW_COOLDOWN_TURNS,
  shouldWarnEscrowFunding,
} from "@/lib/corporations/escrowFunding";
import { DenseSection, InlineStatus, KVRow, Segmented, SmallButton } from "../dense/DenseKit";

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

  // Under the market pool the corp no longer bankrolls buybacks. The panel only
  // has something to say when legacy escrow money is still sitting there.
  if (managedMarketActive && escrowBalance === 0) return null;

  return (
    <DenseSection title="Buyback escrow">
      <div className="space-y-2 py-1">
        <p className="text-xs text-muted">
          {managedMarketActive
            ? "At-market trades settle against the currency market pool. Escrow left over from the old buyback desk can be moved back to the treasury."
            : "Choose whether share sell-backs settle from the treasury or from a funded escrow."}
        </p>

        {!managedMarketActive && (
          <Segmented
            ariaLabel="Buyback mode"
            options={[
              { value: "instant", label: "Instant buyback" },
              { value: "escrow", label: "Escrow" },
            ]}
            value={editShareBuybackMode}
            onChange={(mode) => setEditShareBuybackMode(mode)}
          />
        )}

        <dl>
          <KVRow
            label="Escrow balance"
            value={
              <span className={escrowBalance >= 0 ? "text-foreground" : "text-error"}>
                {escrowBalance < 0 ? "-" : ""}
                {fmtLocal(Math.abs(escrowBalance))}
              </span>
            }
            hint={escrowBalance >= 0 ? "asset" : "debt"}
            title={
              escrowBalance >= 0
                ? "A positive escrow counts as a corporate asset."
                : "A negative escrow is a buyback debt and lowers the valuation."
            }
          />
        </dl>

        {!managedMarketActive && (
          <p className="text-[11px] leading-snug text-muted">
            On dissolution or buyout the escrow settles first. A positive balance returns to the
            treasury and is paid out with everything else; a negative balance is covered from the
            corporation&apos;s assets, and any shortfall falls on shareholders.
          </p>
        )}

        {!managedMarketActive && (
          <div className="space-y-1">
            <label className="flex items-center justify-between gap-2 text-xs text-muted">
              Auto-fund per turn
              <span className="inline-flex items-center gap-1">
                <span>{sym}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={editEscrowFundingPerTurn}
                  onChange={(e) => setEditEscrowFundingPerTurn(e.target.value)}
                  disabled={!isEscrowMode}
                  placeholder="0"
                  className="h-7 w-28 rounded-md border border-card-border bg-background px-2 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none disabled:opacity-50"
                />
              </span>
            </label>
            {showFundingWarning && (
              <p className="text-[11px] leading-snug text-warning">
                This is more than recent net income (~{fmtLocal(recentNetIncome)}/turn). The desk
                will sweep the whole treasury into escrow each turn and leave cash at 0.
              </p>
            )}
            <div className="flex justify-end">
              <SmallButton tone="primary" onClick={onSaveSettings} disabled={saving}>
                {saving ? "Saving" : "Save buyback settings"}
              </SmallButton>
            </div>
          </div>
        )}

        {(!managedMarketActive || escrowBalance > 0) && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted">{sym}</span>
              <input
                type="number"
                min={1}
                step={1}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                disabled={!canWithdraw}
                placeholder="0"
                aria-label="Escrow withdrawal amount"
                className="h-7 min-w-0 flex-1 rounded-md border border-card-border bg-background px-2 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none disabled:opacity-50"
              />
              <SmallButton
                onClick={handleWithdraw}
                disabled={
                  withdrawing || !canWithdraw || !withdrawAmount || Number(withdrawAmount) <= 0
                }
              >
                {withdrawing ? "Withdrawing" : "Withdraw to treasury"}
              </SmallButton>
            </div>
            <p className="text-[11px] text-muted">
              {onCooldown
                ? `Available again in ${cooldownRemaining} turns.`
                : escrowBalance <= 0
                  ? "No positive balance to withdraw."
                  : `Once every ${ESCROW_WITHDRAW_COOLDOWN_TURNS} turns; escrow cannot go below zero.`}
            </p>
            <InlineStatus message={withdrawError} tone="error" />
            <InlineStatus message={withdrawSuccess} tone="success" />
          </div>
        )}
      </div>
    </DenseSection>
  );
}
