"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { CorporationDetail, MarketOrder, MyShareOrder } from "../CorporationPageTypes";
import PrivateSalePanel from "./PrivateSalePanel";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { useCurrency } from "@/contexts/CurrencyContext";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import {
  estimateImplicitAutoConvertCoverage,
  estimateMaxConvertibleAmount,
  estimateExplicitPayCoverage,
  refineMaxAffordableInteger,
} from "@/lib/currency/purchaseAffordability";
import {
  estimateCorpMaxSpendableTargetAmount,
  estimateCorpWalletSpend,
} from "@/lib/currency/corpWalletSpend";
import { MAIN_MODES } from "./sharePurchaseModalTypes";
import type { PurchaseMode, OrderSide } from "./sharePurchaseModalTypes";
import { SharePurchaseAtMarketView } from "./SharePurchaseAtMarketView";
import { SharePurchaseLimitView } from "./SharePurchaseLimitView";
import { SharePurchaseOrderbookView } from "./SharePurchaseOrderbookView";
import { SharePurchaseOrdersView } from "./SharePurchaseOrdersView";

interface SharePurchaseModalProps {
  corporation: CorporationDetail;
  corpId: string;
  myCharacterId: string | null;
  myCashOnHand: number;
  myCurrencyBalances?: Partial<Record<string, number>>;
  myHomeCurrency?: string;
  autoConvertEnabled?: boolean;
  onAutoConvertChange?: (enabled: boolean) => void;
  myShares: number;
  myCorporation: {
    id: string;
    name: string;
    liquidCapital: number;
    /** liquidCapital is stored in this currency (corp's home). Missing on pre-forex corps — treat as USD/₳. */
    liquidCurrencyCode?: string;
    isInvestmentBank?: boolean;
  } | null;
  myOrders: MyShareOrder[];
  marketOrders: MarketOrder[];
  /** Whether the viewer is the current CEO of this corporation — gates the divest-confirm dialog. */
  isCeo?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SharePurchaseModal({
  corporation,
  corpId,
  myCharacterId,
  myCashOnHand,
  myCurrencyBalances,
  myHomeCurrency,
  autoConvertEnabled = true,
  onAutoConvertChange,
  myShares,
  myCorporation,
  myOrders,
  marketOrders,
  isCeo = false,
  onClose,
  onSuccess,
}: SharePurchaseModalProps) {
  const {
    convert,
    toInternal,
    toInternalFrom,
    toLocalOf,
    inputSymbol,
    formatAmount,
    formatPrice,
    forexRates,
  } = useCurrency();

  const corpCurrencyCode = corporation.liquidCurrencyCode as CurrencyCode | undefined;

  const [mode, setMode] = useState<PurchaseMode>("float");
  const [quantity, setQuantity] = useState(0);
  // sharePrice is in corp-local currency post-forex; normalize to ₳ before converting to display currency.
  const [limitPrice, setLimitPrice] = useState(() =>
    convert(
      corpCurrencyCode
        ? toInternalFrom(corporation.sharePrice, corpCurrencyCode)
        : corporation.sharePrice
    )
  );
  const [orderSide, setOrderSide] = useState<OrderSide>("buy");
  const [atMarketSide, setAtMarketSide] = useState<OrderSide>("buy");
  const [limitAsCorp, setLimitAsCorp] = useState(false);
  const [buyAsCorp, setBuyAsCorp] = useState(false);
  const [buyAsInvestmentBank, setBuyAsInvestmentBank] = useState(false);
  const [sellAsCorp, setSellAsCorp] = useState(false);
  const [sellAsInvestmentBank, setSellAsInvestmentBank] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [ceoVacateConfirm, setCeoVacateConfirm] = useState<{ message: string } | null>(null);
  /** Raw digits while focused — `type="number"` spinners / wheel nudging corrupt large share counts. */
  const [quantityDraft, setQuantityDraft] = useState<string | null>(null);
  const [selectedPayCurrency, setSelectedPayCurrency] = useState<CurrencyCode>(
    (myHomeCurrency ??
      COUNTRY_CURRENCY_MAP[corporation.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
      "USD") as CurrencyCode
  );

  function resetQuantity(q: number) {
    setQuantity(q);
    setQuantityDraft(null);
  }

  function parseQtyDigits(raw: string, max?: number): number {
    const digits = raw.replace(/[^0-9]/g, "");
    const n = digits === "" ? 0 : Math.floor(Number(digits));
    let q = Math.max(0, n);
    if (max !== undefined && Number.isFinite(max) && max >= 0) {
      q = Math.min(q, max);
    }
    return q;
  }

  // ─── Currency / rates ─────────────────────────────────────────────────────────
  const corpCurrency = (COUNTRY_CURRENCY_MAP[
    corporation.countryId as keyof typeof COUNTRY_CURRENCY_MAP
  ] ?? "USD") as CurrencyCode;

  const exchangeRates = forexRates;
  const homeCurrencyCode = (myHomeCurrency ?? "USD") as CurrencyCode;

  // ─── Corp liquid capital (₳) ─────────────────────────────────────────────────
  const myCorpLiquidCurrency = (myCorporation?.liquidCurrencyCode ?? "USD") as CurrencyCode;
  const targetTradeCurrency = (corpCurrencyCode ?? corpCurrency) as CurrencyCode;
  const myCorpLiquidInternal = myCorporation
    ? toInternalFrom(myCorporation.liquidCapital, myCorpLiquidCurrency)
    : 0;

  // ─── Shares the viewer's corp holds ──────────────────────────────────────────
  const myCorporationShares = myCorporation
    ? (corporation.shareholders.find((sh) => sh.corporationId === myCorporation.id)?.shares ?? 0)
    : 0;

  // ─── Personal cash anchor ─────────────────────────────────────────────────────
  // Recompute from per-wallet balances so "Personally" matches the wallet panel
  // without round-tripping through stale server math.
  const personalCashAnchor = myCurrencyBalances
    ? Object.entries(myCurrencyBalances).reduce(
        (sum, [code, val]) => sum + toInternalFrom(val ?? 0, code as CurrencyCode),
        0
      )
    : myCashOnHand;

  // ─── Derived prices ───────────────────────────────────────────────────────────
  const floatAvailable = corporation.publicFloat ?? 0;

  const sharePriceAnchor = corpCurrencyCode
    ? toInternalFrom(corporation.sharePrice, corpCurrencyCode)
    : corporation.sharePrice;
  const limitPriceInternal = toInternal(limitPrice);
  const limitPriceLocal = corpCurrencyCode
    ? toLocalOf(limitPrice, corpCurrencyCode)
    : limitPriceInternal;

  const buyCost = quantity * (mode === "limit" ? limitPriceInternal : sharePriceAnchor);

  // ─── Budget / affordability ───────────────────────────────────────────────────
  const activeBudget =
    mode === "float" && (buyAsCorp || buyAsInvestmentBank)
      ? myCorpLiquidInternal
      : personalCashAnchor;

  const selectedPayBalance = (myCurrencyBalances?.[selectedPayCurrency] ?? 0) as number;

  const shouldUseImplicitAutoConvert =
    !buyAsCorp &&
    !buyAsInvestmentBank &&
    !!myCurrencyBalances &&
    autoConvertEnabled &&
    selectedPayCurrency === homeCurrencyCode;

  const homeRate = exchangeRates?.[homeCurrencyCode] ?? null;
  const buyCostInHome = homeRate ? buyCost * homeRate : buyCost;

  const corpAtMarketBuyEstimate =
    buyAsCorp && atMarketSide === "buy"
      ? estimateCorpWalletSpend({
          requiredAmount: quantity * corporation.sharePrice,
          availableBalance: myCorporation?.liquidCapital ?? 0,
          fromCurrency: myCorpLiquidCurrency,
          toCurrency: targetTradeCurrency,
          rates: exchangeRates ?? {},
        })
      : null;

  const corpLimitBuyEstimate =
    limitAsCorp && orderSide === "buy"
      ? estimateCorpWalletSpend({
          requiredAmount: quantity * limitPriceLocal,
          availableBalance: myCorporation?.liquidCapital ?? 0,
          fromCurrency: myCorpLiquidCurrency,
          toCurrency: targetTradeCurrency,
          rates: exchangeRates ?? {},
        })
      : null;

  const explicitPayEstimate =
    !buyAsCorp && !buyAsInvestmentBank && myCurrencyBalances && !shouldUseImplicitAutoConvert
      ? estimateExplicitPayCoverage({
          requiredAmount: buyCostInHome,
          fromCurrency: selectedPayCurrency,
          toCurrency: homeCurrencyCode,
          availableBalance: selectedPayBalance,
          rates: exchangeRates ?? {},
        })
      : null;

  const implicitAutoConvertEstimate =
    !buyAsCorp && !buyAsInvestmentBank && myCurrencyBalances && shouldUseImplicitAutoConvert
      ? estimateImplicitAutoConvertCoverage({
          requiredAmount: buyCostInHome,
          targetCurrency: homeCurrencyCode,
          balances: myCurrencyBalances,
          rates: exchangeRates ?? {},
        })
      : null;

  const maxImplicitSpendableInHome =
    !buyAsCorp && !buyAsInvestmentBank && myCurrencyBalances && shouldUseImplicitAutoConvert
      ? (Object.entries(myCurrencyBalances) as [CurrencyCode, number][])
          .filter(([, balance]) => (balance ?? 0) > 0)
          .reduce((total, [code, balance]) => {
            if (code === homeCurrencyCode) return total + balance;
            return (
              total +
              estimateMaxConvertibleAmount({
                fromCurrency: code,
                toCurrency: homeCurrencyCode,
                balance,
                rates: exchangeRates ?? {},
              })
            );
          }, 0)
      : 0;

  const maxExplicitSpendableInHome =
    !buyAsCorp && !buyAsInvestmentBank && myCurrencyBalances && !shouldUseImplicitAutoConvert
      ? estimateMaxConvertibleAmount({
          fromCurrency: selectedPayCurrency,
          toCurrency: homeCurrencyCode,
          balance: selectedPayBalance,
          rates: exchangeRates ?? {},
        })
      : 0;

  function maxAffordableShares(
    asCorp: boolean,
    pricePerShareInternal: number,
    pricePerShareLocal: number
  ): number {
    if (!Number.isFinite(pricePerShareInternal) || pricePerShareInternal <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    if (asCorp) {
      if (!Number.isFinite(pricePerShareLocal) || pricePerShareLocal <= 0) {
        return Number.POSITIVE_INFINITY;
      }
      return Math.floor(
        estimateCorpMaxSpendableTargetAmount({
          availableBalance: myCorporation?.liquidCapital ?? 0,
          fromCurrency: myCorpLiquidCurrency,
          toCurrency: targetTradeCurrency,
          rates: exchangeRates ?? {},
        }) / pricePerShareLocal
      );
    }
    if (!myCurrencyBalances) return Math.floor(myCashOnHand / pricePerShareInternal);

    const unitCostInHome = homeRate ? pricePerShareInternal * homeRate : pricePerShareInternal;
    if (!Number.isFinite(unitCostInHome) || unitCostInHome <= 0) {
      return Number.POSITIVE_INFINITY;
    }

    if (shouldUseImplicitAutoConvert) {
      return Math.floor(maxImplicitSpendableInHome / unitCostInHome);
    }
    if (selectedPayCurrency === homeCurrencyCode) {
      return Math.floor(selectedPayBalance / unitCostInHome);
    }
    return Math.floor(maxExplicitSpendableInHome / unitCostInHome);
  }

  const maxBuyableShares = Math.max(
    0,
    Math.min(
      buyAsInvestmentBank ? Number.MAX_SAFE_INTEGER : floatAvailable,
      refineMaxAffordableInteger({
        initialGuess: buyAsInvestmentBank
          ? Math.floor(myCorpLiquidInternal / sharePriceAnchor)
          : maxAffordableShares(buyAsCorp, sharePriceAnchor, corporation.sharePrice),
        upperBound: buyAsInvestmentBank ? Number.MAX_SAFE_INTEGER : floatAvailable,
        canAfford: (candidateShares) => {
          if (candidateShares <= 0) return true;
          const candidateCost = candidateShares * sharePriceAnchor;
          const candidateCostInHome = homeRate ? candidateCost * homeRate : candidateCost;
          if (buyAsInvestmentBank) return candidateCost <= myCorpLiquidInternal;
          if (buyAsCorp) {
            const estimate = estimateCorpWalletSpend({
              requiredAmount: candidateShares * corporation.sharePrice,
              availableBalance: myCorporation?.liquidCapital ?? 0,
              fromCurrency: myCorpLiquidCurrency,
              toCurrency: targetTradeCurrency,
              rates: exchangeRates ?? {},
            });
            return estimate?.canAfford ?? false;
          }
          if (!myCurrencyBalances) return candidateCost <= myCashOnHand;
          if (shouldUseImplicitAutoConvert) {
            const estimate = estimateImplicitAutoConvertCoverage({
              requiredAmount: candidateCostInHome,
              targetCurrency: homeCurrencyCode,
              balances: myCurrencyBalances,
              rates: exchangeRates ?? {},
            });
            return (estimate?.spendableInTarget ?? 0) >= candidateCostInHome;
          }
          if (selectedPayCurrency === homeCurrencyCode) {
            return selectedPayBalance >= candidateCostInHome;
          }
          const estimate = estimateExplicitPayCoverage({
            requiredAmount: candidateCostInHome,
            fromCurrency: selectedPayCurrency,
            toCurrency: homeCurrencyCode,
            availableBalance: selectedPayBalance,
            rates: exchangeRates ?? {},
          });
          return estimate?.canAfford ?? false;
        },
      })
    )
  );

  const limitPersonalHomeBalance = myCurrencyBalances
    ? (myCurrencyBalances[homeCurrencyCode] ?? 0)
    : myCashOnHand;

  const maxLimitBuyShares = Math.max(
    0,
    (() => {
      const initialGuess = limitAsCorp
        ? maxAffordableShares(limitAsCorp, limitPriceInternal, limitPriceLocal)
        : homeRate && homeRate > 0
          ? Math.floor(limitPersonalHomeBalance / (limitPriceInternal * homeRate))
          : Math.floor(limitPersonalHomeBalance / limitPriceInternal);
      return refineMaxAffordableInteger({
        initialGuess,
        upperBound: Math.max(0, initialGuess + 3),
        canAfford: (candidateShares) => {
          if (candidateShares <= 0) return true;
          const candidateCost = candidateShares * limitPriceInternal;
          const candidateCostInHome = homeRate ? candidateCost * homeRate : candidateCost;
          if (limitAsCorp) {
            const estimate = estimateCorpWalletSpend({
              requiredAmount: candidateShares * limitPriceLocal,
              availableBalance: myCorporation?.liquidCapital ?? 0,
              fromCurrency: myCorpLiquidCurrency,
              toCurrency: targetTradeCurrency,
              rates: exchangeRates ?? {},
            });
            return estimate?.canAfford ?? false;
          }
          return limitPersonalHomeBalance >= candidateCostInHome;
        },
      });
    })()
  );

  // ─── Affordability flags ──────────────────────────────────────────────────────
  const floatInsufficient = mode === "float" && !buyAsInvestmentBank && quantity > floatAvailable;
  const floatFundsShort =
    mode === "float" &&
    quantity > 0 &&
    (buyAsInvestmentBank
      ? buyCost > myCorpLiquidInternal
      : buyAsCorp
        ? !(corpAtMarketBuyEstimate?.canAfford ?? false)
        : !myCurrencyBalances
          ? buyCost > myCashOnHand
          : shouldUseImplicitAutoConvert
            ? (implicitAutoConvertEstimate?.spendableInTarget ?? 0) < buyCostInHome
            : selectedPayCurrency === homeCurrencyCode
              ? selectedPayBalance < buyCostInHome
              : !(explicitPayEstimate?.canAfford ?? false));

  const limitBuyBudget = limitAsCorp ? myCorpLiquidInternal : personalCashAnchor;
  const limitBuyFundsShort =
    mode === "limit" &&
    orderSide === "buy" &&
    quantity > 0 &&
    (limitAsCorp
      ? !(corpLimitBuyEstimate?.canAfford ?? false)
      : limitPersonalHomeBalance < buyCostInHome);

  const limitSellSharesAvail = limitAsCorp ? myCorporationShares : myShares;
  const limitSellInsufficient =
    mode === "limit" && orderSide === "sell" && quantity > limitSellSharesAvail;

  const limitBuyFillsNow =
    mode === "limit" &&
    orderSide === "buy" &&
    toInternal(limitPrice) >= sharePriceAnchor &&
    floatAvailable > 0;
  const limitSellFillsNow =
    mode === "limit" && orderSide === "sell" && toInternal(limitPrice) <= sharePriceAnchor;

  const sellAtMarketInsufficient =
    atMarketSide === "sell" &&
    !sellAsInvestmentBank &&
    quantity > (sellAsCorp ? myCorporationShares : myShares);

  const ratesNeededButMissing =
    !exchangeRates &&
    ((!(buyAsCorp ?? false) &&
      !buyAsInvestmentBank &&
      !!myCurrencyBalances &&
      (shouldUseImplicitAutoConvert
        ? (myCurrencyBalances[homeCurrencyCode] ?? 0) < buyCostInHome
        : selectedPayCurrency !== homeCurrencyCode)) ||
      (!!buyAsCorp && myCorpLiquidCurrency !== targetTradeCurrency));

  // ─── Budget display strings ───────────────────────────────────────────────────
  const personalBudgetLabel = shouldUseImplicitAutoConvert
    ? `Spendable in ${homeCurrencyCode}`
    : `Available in ${selectedPayCurrency}`;
  const personalBudgetValue = shouldUseImplicitAutoConvert
    ? implicitAutoConvertEstimate
      ? formatCurrencyFaceAmount(implicitAutoConvertEstimate.spendableInTarget, homeCurrencyCode)
      : formatAmount(personalCashAnchor)
    : formatCurrencyFaceAmount(selectedPayBalance, selectedPayCurrency);

  const isActiveCorpBuy =
    (mode === "float" && atMarketSide === "buy" && buyAsCorp) ||
    (mode === "limit" && orderSide === "buy" && limitAsCorp);

  const estimatedFxFeeAnchor = isActiveCorpBuy
    ? toInternalFrom(
        (mode === "float" ? corpAtMarketBuyEstimate?.spreadFee : corpLimitBuyEstimate?.spreadFee) ??
          0,
        myCorpLiquidCurrency
      )
    : shouldUseImplicitAutoConvert
      ? Object.entries(implicitAutoConvertEstimate?.spreadFees ?? {}).reduce(
          (total, [code, fee]) => total + toInternalFrom(fee ?? 0, code as CurrencyCode),
          0
        )
      : toInternalFrom(explicitPayEstimate?.spreadFee ?? 0, selectedPayCurrency);

  const personalAfterPurchase = shouldUseImplicitAutoConvert
    ? (() => {
        const spendable = implicitAutoConvertEstimate?.spendableInTarget ?? 0;
        return spendable < buyCostInHome
          ? `Short by ${formatCurrencyFaceAmount(buyCostInHome - spendable, homeCurrencyCode)}`
          : formatCurrencyFaceAmount(spendable - buyCostInHome, homeCurrencyCode);
      })()
    : (() => {
        const requiredSpend = explicitPayEstimate?.spendAmount ?? buyCostInHome;
        return explicitPayEstimate && !explicitPayEstimate.canAfford
          ? `Short by ${formatCurrencyFaceAmount(
              buyCostInHome - explicitPayEstimate.deliveredAmount,
              homeCurrencyCode
            )}`
          : formatCurrencyFaceAmount(selectedPayBalance - requiredSpend, selectedPayCurrency);
      })();

  const corpAtMarketAfterPurchase = floatFundsShort
    ? `Short by ${formatAmount(
        Math.round(
          toInternalFrom(
            corpAtMarketBuyEstimate?.requiredFromAmount ?? quantity * corporation.sharePrice,
            myCorpLiquidCurrency
          ) - activeBudget
        )
      )}`
    : formatAmount(
        Math.round(
          toInternalFrom(
            corpAtMarketBuyEstimate?.remainingBalance ?? myCorporation?.liquidCapital ?? 0,
            myCorpLiquidCurrency
          )
        )
      );

  const limitPersonalBudgetLabel = `Available in ${homeCurrencyCode}`;
  const limitPersonalBudgetValue = formatCurrencyFaceAmount(
    limitPersonalHomeBalance,
    homeCurrencyCode
  );
  const limitPersonalAfterPurchase = limitBuyFundsShort
    ? `Short by ${formatCurrencyFaceAmount(buyCostInHome - limitPersonalHomeBalance, homeCurrencyCode)}`
    : formatCurrencyFaceAmount(limitPersonalHomeBalance - buyCostInHome, homeCurrencyCode);

  const corpLimitAfterEscrow = limitBuyFundsShort
    ? `Short by ${formatAmount(
        Math.round(
          toInternalFrom(
            corpLimitBuyEstimate?.requiredFromAmount ?? quantity * limitPriceLocal,
            myCorpLiquidCurrency
          ) - limitBuyBudget
        )
      )}`
    : formatAmount(
        Math.round(
          toInternalFrom(
            corpLimitBuyEstimate?.remainingBalance ?? myCorporation?.liquidCapital ?? 0,
            myCorpLiquidCurrency
          )
        )
      );

  // ─── Derived order lists ──────────────────────────────────────────────────────
  const openOrders = myOrders.filter((o) => o.status === "open");
  const openBuyOrders = openOrders.filter((o) => o.type === "buy");
  const openSellOrders = openOrders.filter((o) => o.type === "sell");
  const orderbookBids = marketOrders.filter((o) => !o.isMine && o.type === "buy");
  const orderbookAsks = marketOrders.filter((o) => !o.isMine && o.type === "sell");
  const orderbookCount = orderbookBids.length + orderbookAsks.length;

  // ─── Submit conditions ────────────────────────────────────────────────────────
  const canSubmitFloat =
    mode === "float" &&
    quantity > 0 &&
    !(atMarketSide === "buy" && ratesNeededButMissing) &&
    (atMarketSide === "buy" ? !floatInsufficient && !floatFundsShort : !sellAtMarketInsufficient);

  const canSubmitLimit =
    mode === "limit" &&
    quantity > 0 &&
    limitPrice > 0 &&
    !(orderSide === "buy" && ratesNeededButMissing) &&
    !limitBuyFundsShort &&
    !limitSellInsufficient;

  // ─── Mode/side switching ──────────────────────────────────────────────────────
  function switchMode(next: PurchaseMode) {
    setMode(next);
    setError("");
    setSuccessMsg("");
    resetQuantity(0);
    setLimitAsCorp(false);
  }

  function switchAtMarketSide(side: OrderSide) {
    setAtMarketSide(side);
    resetQuantity(0);
    setError("");
    if (side === "sell") {
      setBuyAsCorp(false);
      setBuyAsInvestmentBank(false);
    }
    if (side === "buy") {
      setSellAsCorp(false);
      setSellAsInvestmentBank(false);
    }
  }

  function switchOrderSide(side: OrderSide) {
    setOrderSide(side);
    resetQuantity(0);
    setError("");
    setSuccessMsg("");
    setLimitAsCorp(false);
  }

  // ─── API handlers ─────────────────────────────────────────────────────────────
  async function handleBuyAtMarket() {
    if (!canSubmitFloat) return;
    setError("");
    setLoading(true);
    try {
      if (buyAsInvestmentBank && myCorporation) {
        const res = await fetch(`/api/corporations/${myCorporation.id}/bank/prop/positions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asset: "equity", ref: corporation._id, units: quantity }),
        });
        const data = (await res.json()) as { cost?: number; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not open investment-bank position");
          return;
        }
        setSuccessMsg(
          `Investment bank opened a ${quantity.toLocaleString()}-share position for ${formatAmount(data.cost ?? 0)}`
        );
        onSuccess();
        requestCharacterStatsRefetch();
        onClose();
        return;
      }
      const res = await fetch(`/api/corporations/${corpId}/shares/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shares: quantity,
          buyAsCorporation: buyAsCorp,
          ...(myCurrencyBalances && !buyAsCorp ? { payCurrency: selectedPayCurrency } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Purchase failed");
        return;
      }
      onSuccess();
      requestCharacterStatsRefetch();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSellAtMarket(confirmVacate = false) {
    if (!confirmVacate && (!canSubmitFloat || atMarketSide !== "sell")) return;
    setError("");
    setLoading(true);
    try {
      if (sellAsInvestmentBank && myCorporation) {
        const res = await fetch(`/api/corporations/${myCorporation.id}/bank/prop/positions`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asset: "equity", ref: corporation._id, units: quantity }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not close investment-bank position");
          return;
        }
        onSuccess();
        requestCharacterStatsRefetch();
        onClose();
        return;
      }
      const res = await fetch(`/api/corporations/${corpId}/shares/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shares: quantity,
          sellAsCorporation: sellAsCorp,
          ...(confirmVacate ? { confirmCeoVacate: true } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string; requiresCeoVacateConfirm?: boolean };
      if (!res.ok) {
        if (res.status === 409 && data.requiresCeoVacateConfirm) {
          setCeoVacateConfirm({
            message: data.error ?? "Selling all your shares will remove you as CEO. Continue?",
          });
          return;
        }
        setError(data.error ?? "Sell failed");
        return;
      }
      setCeoVacateConfirm(null);
      onSuccess();
      requestCharacterStatsRefetch();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handlePlaceLimitOrder() {
    if (!canSubmitLimit) return;
    setError("");
    setSuccessMsg("");
    setLoading(true);
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: orderSide,
          shares: quantity,
          // Server stores pricePerShare in target corp's liquidCurrencyCode
          // (Option B); convert display → target-local.
          pricePerShare: corpCurrencyCode
            ? toLocalOf(limitPrice, corpCurrencyCode)
            : toInternal(limitPrice),
          placeAsCorporation: limitAsCorp,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        filled?: boolean;
        cost?: number;
        proceeds?: number;
        escrowAmount?: number;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to place order");
        return;
      }
      if (data.filled) {
        const detail =
          orderSide === "buy"
            ? `Filled immediately — bought ${quantity.toLocaleString("en-US")} shares for ${formatAmount(data.cost ?? 0)}`
            : `Filled immediately — sold ${quantity.toLocaleString("en-US")} shares for ${formatAmount(data.proceeds ?? 0)}`;
        setSuccessMsg(detail);
        onSuccess();
        requestCharacterStatsRefetch();
        resetQuantity(0);
      } else {
        // data.escrowAmount is target-corp-local (Option B); normalize to ₳ for formatAmount.
        const escrowAnchorDisplay = corpCurrencyCode
          ? toInternalFrom(data.escrowAmount ?? 0, corpCurrencyCode)
          : (data.escrowAmount ?? 0);
        const detail =
          orderSide === "buy"
            ? `Buy order placed. ${formatAmount(escrowAnchorDisplay)} held in escrow.`
            : `Sell order placed. ${quantity.toLocaleString("en-US")} shares reserved.`;
        setSuccessMsg(detail);
        onSuccess();
        if (orderSide === "buy") requestCharacterStatsRefetch();
        resetQuantity(0);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="flex w-full max-w-md max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-card-border bg-card shadow-modal">
          {/* ─── Header ──────────────────────────────────────────────────────── */}
          <div className="flex shrink-0 items-start justify-between border-b border-card-border px-6 py-4">
            <div>
              {mode === "orders" ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => switchMode("float")}
                    className="text-xs text-muted hover:text-foreground transition-colors"
                  >
                    ← Back
                  </button>
                  <h2 className="text-base font-semibold text-foreground">Open Orders</h2>
                </div>
              ) : (
                <h2 className="text-base font-semibold text-foreground">Buy / Sell Shares</h2>
              )}
              <p className="mt-0.5 text-sm text-muted">
                {corporation.name}
                <span className="mx-2 text-card-border">·</span>
                <span className="tabular-nums text-foreground font-medium">
                  {formatPrice(toInternalFrom(corporation.sharePrice, corpCurrency), corpCurrency)}
                </span>
                {(() => {
                  if (!myHomeCurrency || corpCurrency === myHomeCurrency) return null;
                  return (
                    <span className="ml-1 text-xs tabular-nums text-muted/70">
                      ({formatCurrencyFaceAmount(corporation.sharePrice, corpCurrency)} native)
                    </span>
                  );
                })()}
                {mode !== "orders" && floatAvailable > 0 && (
                  <>
                    <span className="mx-2 text-card-border">·</span>
                    <span className="tabular-nums">
                      {floatAvailable.toLocaleString("en-US")} in float
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 ml-4 -mt-0.5">
              {mode !== "orders" && openOrders.length > 0 && (
                <button
                  onClick={() => switchMode("orders")}
                  className="flex items-center gap-1.5 rounded-lg border border-card-border bg-card-elevated px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
                >
                  Orders
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                    {openOrders.length}
                  </span>
                </button>
              )}
              <button
                onClick={onClose}
                className="text-muted hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* ─── Mode picker ─────────────────────────────────────────────────── */}
          {mode !== "orders" && (
            <div className="shrink-0 border-b border-card-border px-6 py-4">
              <div className="flex overflow-hidden rounded-lg border border-card-border text-sm">
                {MAIN_MODES.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => switchMode(m.id)}
                    className={[
                      "flex-1 py-2.5 text-center transition-colors",
                      i > 0 ? "border-l border-card-border" : "",
                      mode === m.id
                        ? "bg-primary text-white font-semibold"
                        : "bg-card-elevated text-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    {m.label}
                    {m.id === "orderbook" && orderbookCount > 0 && (
                      <span
                        className={`ml-1 text-[10px] font-bold ${mode === "orderbook" ? "text-white/80" : "text-primary"}`}
                      >
                        ({orderbookCount})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── Body ────────────────────────────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {mode === "float" && (
              <SharePurchaseAtMarketView
                atMarketSide={atMarketSide}
                buyAsCorp={buyAsCorp}
                buyAsInvestmentBank={buyAsInvestmentBank}
                sellAsCorp={sellAsCorp}
                sellAsInvestmentBank={sellAsInvestmentBank}
                quantity={quantity}
                quantityDraft={quantityDraft}
                selectedPayCurrency={selectedPayCurrency}
                onSwitchSide={switchAtMarketSide}
                setBuyAsCorp={setBuyAsCorp}
                setBuyAsInvestmentBank={setBuyAsInvestmentBank}
                setSellAsCorp={setSellAsCorp}
                setSellAsInvestmentBank={setSellAsInvestmentBank}
                setQuantity={setQuantity}
                setQuantityDraft={setQuantityDraft}
                setSelectedPayCurrency={setSelectedPayCurrency}
                resetQuantity={resetQuantity}
                parseQtyDigits={parseQtyDigits}
                myCorporation={myCorporation}
                myShares={myShares}
                myCorporationShares={myCorporationShares}
                isCeo={isCeo}
                myCurrencyBalances={myCurrencyBalances}
                autoConvertEnabled={autoConvertEnabled}
                onAutoConvertChange={onAutoConvertChange}
                corporationSharePrice={corporation.sharePrice}
                personalCashAnchor={personalCashAnchor}
                myCorpLiquidInternal={myCorpLiquidInternal}
                myCorpLiquidCurrency={myCorpLiquidCurrency}
                floatAvailable={floatAvailable}
                maxBuyableShares={maxBuyableShares}
                buyCost={buyCost}
                activeBudget={activeBudget}
                personalBudgetLabel={personalBudgetLabel}
                personalBudgetValue={personalBudgetValue}
                personalAfterPurchase={personalAfterPurchase}
                corpAtMarketAfterPurchase={corpAtMarketAfterPurchase}
                estimatedFxFeeAnchor={estimatedFxFeeAnchor}
                floatInsufficient={floatInsufficient}
                floatFundsShort={floatFundsShort}
                sellAtMarketInsufficient={sellAtMarketInsufficient}
                ratesNeededButMissing={ratesNeededButMissing}
                homeCurrencyCode={homeCurrencyCode}
                corpCurrency={corpCurrency}
              />
            )}

            {mode === "limit" && (
              <SharePurchaseLimitView
                orderSide={orderSide}
                limitAsCorp={limitAsCorp}
                quantity={quantity}
                quantityDraft={quantityDraft}
                limitPrice={limitPrice}
                successMsg={successMsg}
                onSwitchSide={switchOrderSide}
                setLimitAsCorp={setLimitAsCorp}
                setQuantity={setQuantity}
                setQuantityDraft={setQuantityDraft}
                setLimitPrice={setLimitPrice}
                resetQuantity={resetQuantity}
                parseQtyDigits={parseQtyDigits}
                onSwitchToOrders={() => switchMode("orders")}
                onSuccess={onSuccess}
                myCorporation={myCorporation}
                myShares={myShares}
                myCorporationShares={myCorporationShares}
                corpId={corpId}
                corpCurrencyCode={corpCurrencyCode}
                personalCashAnchor={personalCashAnchor}
                myCorpLiquidInternal={myCorpLiquidInternal}
                myCorpLiquidCurrency={myCorpLiquidCurrency}
                limitSellSharesAvail={limitSellSharesAvail}
                maxLimitBuyShares={maxLimitBuyShares}
                buyCost={buyCost}
                limitBuyBudget={limitBuyBudget}
                limitPersonalBudgetLabel={limitPersonalBudgetLabel}
                limitPersonalBudgetValue={limitPersonalBudgetValue}
                limitPersonalAfterPurchase={limitPersonalAfterPurchase}
                corpLimitAfterEscrow={corpLimitAfterEscrow}
                limitBuyFundsShort={limitBuyFundsShort}
                limitSellInsufficient={limitSellInsufficient}
                limitBuyFillsNow={limitBuyFillsNow}
                limitSellFillsNow={limitSellFillsNow}
                ratesNeededButMissing={ratesNeededButMissing}
                estimatedFxFeeAnchor={estimatedFxFeeAnchor}
                inputSymbol={inputSymbol}
                openBuyOrders={openBuyOrders}
                openSellOrders={openSellOrders}
              />
            )}

            {mode === "orderbook" && (
              <SharePurchaseOrderbookView
                orderbookAsks={orderbookAsks}
                orderbookBids={orderbookBids}
                myCorporation={myCorporation}
                personalCashAnchor={personalCashAnchor}
                myCorpLiquidInternal={myCorpLiquidInternal}
                myCorpLiquidCurrency={myCorpLiquidCurrency}
                corpCurrencyCode={corpCurrencyCode}
                corpId={corpId}
                onSuccess={onSuccess}
              />
            )}

            {mode === "private" && (
              <PrivateSalePanel
                corporation={corporation}
                myCharacterId={myCharacterId}
                corpId={corpId}
                myShares={myShares}
                isCeo={isCeo}
                onToast={(msg, variant) => {
                  if (variant === "error") setError(msg);
                  else {
                    setSuccessMsg(msg);
                    onSuccess();
                  }
                }}
                forceOpen
              />
            )}

            {mode === "orders" && (
              <SharePurchaseOrdersView
                openBuyOrders={openBuyOrders}
                openSellOrders={openSellOrders}
                corpId={corpId}
                corpCurrencyCode={corpCurrencyCode}
                onSuccess={onSuccess}
              />
            )}

            {corporation.ceoShareWindow && (
              <p className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] leading-snug text-warning">
                CEO purchase limit: used{" "}
                {corporation.ceoShareWindow.acquiredShares.toLocaleString("en-US")}/
                {corporation.ceoShareWindow.capShares.toLocaleString("en-US")} shares this{" "}
                {corporation.ceoShareWindow.windowTurns}-turn window (
                {corporation.ceoShareWindow.remainingShares.toLocaleString("en-US")} remaining
                {corporation.ceoShareWindow.freesUpInTurns > 0
                  ? `, full capacity in ${corporation.ceoShareWindow.freesUpInTurns} turns`
                  : ""}
                ).
              </p>
            )}

            {error && <p className="text-xs text-error">{error}</p>}
          </div>

          {/* ─── Footer ──────────────────────────────────────────────────────── */}
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-card-border px-6 py-4">
            <Button variant="ghost" onClick={onClose} className="text-sm">
              {mode === "orders" ? "Close" : "Cancel"}
            </Button>
            {mode === "float" && (
              <Button
                variant="primary"
                onClick={atMarketSide === "buy" ? handleBuyAtMarket : () => handleSellAtMarket()}
                disabled={!canSubmitFloat || loading}
                isLoading={loading}
                className={`text-sm shadow-none ${
                  atMarketSide === "sell"
                    ? "bg-error hover:bg-error/90"
                    : "bg-success hover:bg-success/90"
                }`}
              >
                {atMarketSide === "buy" ? "Buy Shares" : "Sell Shares"}
              </Button>
            )}
            {mode === "limit" && (
              <Button
                variant="primary"
                onClick={handlePlaceLimitOrder}
                disabled={!canSubmitLimit || loading}
                isLoading={loading}
                className={`text-sm shadow-none ${
                  orderSide === "sell"
                    ? "bg-error hover:bg-error/90"
                    : "bg-success hover:bg-success/90"
                }`}
              >
                {orderSide === "buy" ? "Place Buy Order" : "Place Sell Order"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ─── CEO divest confirm dialog (server-enforced 409 gate) ──────────── */}
      {ceoVacateConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-warning/40 bg-card p-5 shadow-modal space-y-3">
            <h3 className="text-sm font-semibold text-foreground">This will remove you as CEO</h3>
            <p className="text-xs leading-relaxed text-muted">{ceoVacateConfirm.message}</p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => setCeoVacateConfirm(null)}
                disabled={loading}
                className="text-sm"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSellAtMarket(true)}
                disabled={loading}
                isLoading={loading}
                className="text-sm bg-error hover:bg-error/90"
              >
                Sell &amp; Step Down
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
