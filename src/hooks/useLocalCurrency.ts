"use client";

import { useMemo } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Formatters pre-wired to a LOCAL currency (e.g. a corp's `liquidCurrencyCode`).
 * Each helper accepts a LOCAL amount and renders it in the viewer's wallet-
 * preferred display currency — anchor normalization (local → ₳ → display)
 * happens internally so call sites never touch `toInternalFrom`.
 */
export interface LocalCurrencyFormatters {
  fmtPrice: (localAmount: number) => string;
  fmtPriceOrder: (localAmount: number) => string;
  fmtAmount: (localAmount: number) => string;
  fmtAmountChip: (localAmount: number) => string;
  fmtFull: (localAmount: number) => string;
  /** Convert a LOCAL amount to ₳ — use when passing to helpers that expect ₳. */
  toAnchor: (localAmount: number) => number;
}

/**
 * Bridge for values stored in a LOCAL currency (post-forex Task 18A/18B).
 * Callers pass the source-of-truth currency code once; returned formatters
 * accept LOCAL numbers and handle the local → ₳ pivot + wallet-pref rendering
 * in one step. Undefined `code` falls through unchanged so pre-forex callers
 * (stored in ₳) still render correctly.
 */
export function useLocalCurrency(code: CurrencyCode | string | undefined): LocalCurrencyFormatters {
  const {
    formatAmount,
    formatAmountChip,
    formatPrice,
    formatPriceOrder,
    formatFull,
    toInternalFrom,
  } = useCurrency();

  return useMemo(() => {
    const native = code as CurrencyCode | undefined;
    const toAnchor = (local: number) => (native ? toInternalFrom(local, native) : local);
    return {
      fmtPrice: (local) => formatPrice(toAnchor(local), native),
      fmtPriceOrder: (local) => formatPriceOrder(toAnchor(local), native),
      fmtAmount: (local) => formatAmount(toAnchor(local), native),
      fmtAmountChip: (local) => formatAmountChip(toAnchor(local), native),
      fmtFull: (local) => formatFull(toAnchor(local), native),
      toAnchor,
    };
  }, [
    code,
    formatAmount,
    formatAmountChip,
    formatPrice,
    formatPriceOrder,
    formatFull,
    toInternalFrom,
  ]);
}
