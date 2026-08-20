"use client";

import { useState, useMemo } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import {
  MAX_FORWARD_SHARE_SPLIT_MULTIPLIER,
  SHARE_CONSOLIDATION_MIN_TOTAL_SHARES,
} from "@/lib/constants/corporations";
import type { MarketOrder, UseShareTradingProps, UseShareTradingReturn } from "../types";

export function useShareTrading({
  corporation,
  myCharacterId,
  myCashOnHand: _myCashOnHand,
  isCeo,
  corpId,
  onRefresh,
  setToast,
  refreshOrders,
  marketOrders,
  myCorporation,
}: UseShareTradingProps & {
  myCharacterId: string | null;
  myCashOnHand: number;
  isCeo: boolean;
  corpId: string;
  onRefresh: () => void;
  setToast: (toast: { message: string; variant: "success" | "error" } | null) => void;
  refreshOrders: () => Promise<void>;
  marketOrders: MarketOrder[];
  myCorporation?: UseShareTradingProps["myCorporation"];
}): UseShareTradingReturn {
  const { toInternal, toInternalFrom, toLocalOf, formatFull } = useCurrency();
  // corporation.sharePrice / liquidCurrencyCode are both corp-local (v0.2.6);
  // normalize to ₳ for the preview amounts so they can be rendered with the
  // same formatAmount() semantics every other corp money field uses.
  const corpCurrencyCode = corporation.liquidCurrencyCode as
    import("@/lib/constants/currencies").CurrencyCode | undefined;

  // ─── State ────────────────────────────────────────────────────────────────────
  const [sellSharesAmount, setSellSharesAmount] = useState(0);
  const [buySharesAmount, setBuySharesAmount] = useState(0);
  const [buyAsCorp, setBuyAsCorp] = useState(false);
  const [fillAskAsCorp, setFillAskAsCorp] = useState(false);
  const [orderType, setOrderType] = useState<"buy" | "sell">("buy");
  const [orderShares, setOrderShares] = useState(0);
  const [orderPrice, setOrderPrice] = useState(0);
  const [issuePercent, setIssuePercent] = useState(5);
  const [selfIssueShares, setSelfIssueShares] = useState(0);
  const [consolidateTarget, setConsolidateTarget] = useState<number | "">("");
  const [loading, setLoading] = useState(false);

  // ─── Derived values ────────────────────────────────────────────────────────────
  const ISSUANCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const issuanceCooldownRemaining = useMemo(() => {
    return corporation.lastShareIssuance != null
      ? Math.max(
          0,
          ISSUANCE_COOLDOWN_MS - (Date.now() - new Date(corporation.lastShareIssuance).getTime())
        )
      : 0;
  }, [corporation.lastShareIssuance, ISSUANCE_COOLDOWN_MS]);
  const issuanceOnCooldown = issuanceCooldownRemaining > 0;

  const myShares = useMemo(() => {
    const entry = myCharacterId
      ? corporation.shareholders.find((sh) => sh.characterId === myCharacterId)
      : null;
    return entry?.shares ?? 0;
  }, [corporation.shareholders, myCharacterId]);
  const myShareValueLocal = myShares * corporation.sharePrice;
  const myShareValue = corpCurrencyCode
    ? toInternalFrom(myShareValueLocal, corpCurrencyCode)
    : myShareValueLocal;
  const myOwnershipPct =
    corporation.totalShares > 0 ? (myShares / corporation.totalShares) * 100 : 0;

  // CEO issuance preview
  const newSharesToIssue = Math.floor((issuePercent / 100) * corporation.totalShares);
  const issuanceProceedsLocal = newSharesToIssue * corporation.sharePrice;
  const issuanceProceeds = corpCurrencyCode
    ? toInternalFrom(issuanceProceedsLocal, corpCurrencyCode)
    : issuanceProceedsLocal;
  const newTotalAfterIssue = corporation.totalShares + newSharesToIssue;
  const dilutedPrice =
    newTotalAfterIssue > 0
      ? (corporation.sharePrice * corporation.totalShares) / newTotalAfterIssue
      : corporation.sharePrice;

  // CEO self-issue preview
  const selfIssuePricePerShare = corporation.sharePrice * 1.15;
  const selfIssueCostLocal = selfIssueShares * selfIssuePricePerShare;
  const selfIssueCost = corpCurrencyCode
    ? toInternalFrom(selfIssueCostLocal, corpCurrencyCode)
    : selfIssueCostLocal;

  // Share structure calculations
  const shareStructureCooldownTurnsRemaining =
    corporation.shareStructureCooldownTurnsRemaining ?? 0;
  const shareStructureOnCooldown = shareStructureCooldownTurnsRemaining > 0;
  const ceoEligibleForShareStructure =
    isCeo && corporation.countryOwnerId == null && !corporation.isNationalized;
  const canEditShareStructureTarget = ceoEligibleForShareStructure && !shareStructureOnCooldown;
  const canSubmitShareStructure = canEditShareStructureTarget;

  const consolidateTargetNum =
    typeof consolidateTarget === "number" && consolidateTarget > 0 ? consolidateTarget : 0;
  const maxForwardTotal = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.floor(corporation.totalShares * MAX_FORWARD_SHARE_SPLIT_MULTIPLIER)
  );
  const minTotalShares =
    corporation.shareConsolidationMinTotalShares ?? SHARE_CONSOLIDATION_MIN_TOTAL_SHARES;
  const isReverseTarget = consolidateTargetNum < corporation.totalShares;
  const isForwardTarget = consolidateTargetNum > corporation.totalShares;
  const shareStructureTargetValid =
    canSubmitShareStructure &&
    consolidateTargetNum > 0 &&
    ((isReverseTarget &&
      consolidateTargetNum >= minTotalShares &&
      consolidateTargetNum < corporation.totalShares) ||
      (isForwardTarget &&
        consolidateTargetNum > corporation.totalShares &&
        consolidateTargetNum <= maxForwardTotal));
  const shareStructurePricePreview =
    consolidateTargetNum > 0 &&
    corporation.totalShares > 0 &&
    consolidateTargetNum !== corporation.totalShares &&
    ((isReverseTarget &&
      consolidateTargetNum >= minTotalShares &&
      consolidateTargetNum < corporation.totalShares) ||
      (isForwardTarget &&
        consolidateTargetNum > corporation.totalShares &&
        consolidateTargetNum <= maxForwardTotal));
  const newPriceAfterShareStructure = shareStructurePricePreview
    ? (corporation.sharePrice * corporation.totalShares) / consolidateTargetNum
    : null;

  // ─── Handlers ─────────────────────────────────────────────────────────────────
  const setActionError = (msg: string) => {
    if (msg) {
      setToast({ message: msg, variant: "error" });
    } else {
      setToast(null);
    }
  };
  const setActionSuccess = (msg: string) => {
    if (msg) {
      setToast({ message: msg, variant: "success" });
    } else {
      setToast(null);
    }
  };

  async function handleSellAtMarket() {
    if (sellSharesAmount <= 0) return;
    setLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shares: sellSharesAmount }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(
          `Sold ${sellSharesAmount.toLocaleString()} shares for ${formatFull(data.proceeds)}`
        );
        setSellSharesAmount(0);
        onRefresh();
        await refreshOrders();
      } else {
        setActionError(data.error || "Failed to sell shares");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleBuyFromFloat() {
    if (buySharesAmount <= 0) return;
    setLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shares: buySharesAmount, buyAsCorporation: buyAsCorp }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(
          `Bought ${buySharesAmount.toLocaleString()} shares for ${formatFull(data.cost)}`
        );
        setBuySharesAmount(0);
        onRefresh();
        await refreshOrders();
      } else {
        setActionError(data.error || "Failed to buy shares");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handlePlaceOrder() {
    if (orderShares <= 0 || orderPrice <= 0) return;
    setLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: orderType,
          shares: orderShares,
          // Server stores pricePerShare in target corp's liquidCurrencyCode
          // (Option B). Convert display → target-local here; fallback to ₳
          // for pre-forex corps missing a code.
          pricePerShare: corpCurrencyCode
            ? toLocalOf(orderPrice, corpCurrencyCode)
            : toInternal(orderPrice),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.filled) {
          if (orderType === "buy") {
            setActionSuccess(
              `Order filled immediately: bought ${orderShares.toLocaleString()} shares for ${formatFull(data.cost)}`
            );
          } else {
            setActionSuccess(
              `Order filled immediately: sold ${orderShares.toLocaleString()} shares for ${formatFull(data.proceeds)}`
            );
          }
        } else {
          if (orderType === "buy") {
            // data.escrowAmount is target-corp-local (Option B); normalize to
            // ₳ so formatFull can render it in the viewer's display currency
            // like every other corp money field.
            const escrowAnchorDisplay = corpCurrencyCode
              ? toInternalFrom(data.escrowAmount, corpCurrencyCode)
              : data.escrowAmount;
            setActionSuccess(
              `Buy order placed. ${formatFull(escrowAnchorDisplay)} held in escrow.`
            );
          } else {
            setActionSuccess(`Sell order placed. ${orderShares.toLocaleString()} shares reserved.`);
          }
        }
        setOrderShares(0);
        onRefresh();
        await refreshOrders();
      } else {
        setActionError(data.error || "Failed to place order");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelOrder(orderId: string) {
    setLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/orders/${orderId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess("Order cancelled");
        onRefresh();
        await refreshOrders();
      } else {
        setActionError(data.error || "Failed to cancel order");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleFillOrder(orderId: string, fillType: "buy" | "sell", shares?: number) {
    if (!shares || shares < 1) {
      setActionError("Enter the number of shares to fill");
      return;
    }
    setLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/orders/${orderId}/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shares,
          fillAsCorporation: fillType === "sell" && !!myCorporation && fillAskAsCorp,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const verb = fillType === "sell" ? "Bought" : "Sold";
        setActionSuccess(
          `${verb} ${data.sharesFilled.toLocaleString()} shares for ${formatFull(data.total)}`
        );
        onRefresh();
        await refreshOrders();
      } else {
        setActionError(data.error || "Failed to fill order");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handlePublicIssuance() {
    if (newSharesToIssue < 1) return;
    setLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent: issuePercent }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(
          `Issued ${data.sharesIssued.toLocaleString()} shares to public float. Up to ${formatFull(data.proceeds)} flows into the treasury as those shares are bought.`
        );
        onRefresh();
        await refreshOrders();
      } else {
        setActionError(data.error || "Failed to issue shares");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleConsolidateShares() {
    if (!shareStructureTargetValid || consolidateTargetNum <= 0) return;
    setLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/consolidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTotalShares: consolidateTargetNum }),
      });
      const data = await res.json();
      if (res.ok) {
        const verb = data.reverseSplit ? "Reverse split" : "Stock split";
        const cancelled: number = data.cancelledOpenOrders ?? 0;
        const suffix =
          cancelled > 0
            ? ` ${cancelled} open order${cancelled === 1 ? "" : "s"} auto-cancelled and refunded.`
            : "";
        setActionSuccess(
          `${verb}: now ${data.newTotalShares.toLocaleString()} shares at ${data.newSharePrice} (market cap unchanged).${suffix}`
        );
        setConsolidateTarget("");
        onRefresh();
        await refreshOrders();
      } else {
        setActionError(data.error || "Failed to change share structure");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelfIssuance() {
    if (selfIssueShares <= 0) return;
    setLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/self-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shares: selfIssueShares }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionSuccess(
          `Purchased ${data.sharesIssued.toLocaleString()} new shares for ${formatFull(data.totalCost)}. Proceeds added to corporate capital.`
        );
        setSelfIssueShares(0);
        onRefresh();
        await refreshOrders();
      } else {
        setActionError(data.error || "Failed to self-issue shares");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return {
    // State
    sellSharesAmount,
    setSellSharesAmount,
    buySharesAmount,
    setBuySharesAmount,
    buyAsCorp,
    setBuyAsCorp,
    fillAskAsCorp,
    setFillAskAsCorp,
    orderType,
    setOrderType,
    orderShares,
    setOrderShares,
    orderPrice,
    setOrderPrice,
    issuePercent,
    setIssuePercent,
    selfIssueShares,
    setSelfIssueShares,
    consolidateTarget,
    setConsolidateTarget,
    loading,
    setLoading,
    // Derived
    issuanceCooldownRemaining,
    issuanceOnCooldown,
    myShares,
    myShareValue,
    myOwnershipPct,
    newSharesToIssue,
    issuanceProceeds,
    dilutedPrice,
    selfIssuePricePerShare,
    selfIssueCost,
    hasOpenCorpOrders: marketOrders.length > 0,
    shareStructureOnCooldown,
    ceoEligibleForShareStructure,
    canEditShareStructureTarget,
    canSubmitShareStructure,
    consolidateTargetNum,
    maxForwardTotal,
    isReverseTarget,
    isForwardTarget,
    shareStructureTargetValid,
    shareStructurePricePreview,
    newPriceAfterShareStructure,
    // Handlers
    handleSellAtMarket,
    handleBuyFromFloat,
    handlePlaceOrder,
    handleCancelOrder,
    handleFillOrder,
    handlePublicIssuance,
    handleConsolidateShares,
    handleSelfIssuance,
  };
}
