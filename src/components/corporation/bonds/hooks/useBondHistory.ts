"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/** Counterparty resolved with display name + linkable id (one of). */
export interface BondHistoryParty {
  kind: "character" | "imperial" | "corporation" | "government" | "system" | "bondholders";
  characterId?: string;
  imperialCharacterId?: string;
  corporationId?: string;
  countryId?: string;
  name: string;
}

/**
 * Bond reference resolved at API time so the UI doesn't have to do another
 * lookup to display "5% JGB matur=468" or link to the bond detail page.
 */
export interface BondHistoryBondInfo {
  bondId: string;
  issuerType: "corporation" | "sovereign";
  issuerName: string;
  /** Set for corporate bonds — links to /corporation/[id]. */
  issuerCorporationId?: string;
  /** Set for sovereign bonds — links to /country/[code]. */
  issuerCountryId?: string;
  couponRate: number;
  maturityTurn: number;
}

export type BondHistoryType =
  | "bond_coupon"
  | "bond_maturity"
  | "bond_purchase"
  | "bond_issuance"
  | "bond_default"
  | "bond_dissolution_payout";

export type BondHistoryDirection = "all" | "income" | "payment";

export interface BondHistoryEntry {
  id: string;
  type: BondHistoryType;
  turn: number;
  createdAt: string;
  amount: number;
  /**
   * Anchor-currency snapshot of `amount`, captured at emit time. Used by the
   * UI for cross-currency rollups (e.g. summing per-turn totals across JPY +
   * GBP rows). Older rows pre-anchor migration may lack this.
   */
  anchorAmount?: number;
  currencyCode: string;
  /** From meta.source — distinguishes issuer_coupon, issuer_repayment, default_cash_payoff, etc. */
  source?: string;
  /** True when this row is a bond_issuance from the refinance route (debt-for-debt swap, amount=0). */
  refinance?: boolean;
  /** From meta.units — bond unit count when applicable. */
  units?: number;
  /** From meta.couponRate. */
  couponRate?: number;
  /**
   * Cross-currency: when the corp's lc currency differs from the bond's
   * denomination, `currencyCode`/`amount` reflect the corp's books and
   * `bondCurrency`/`bondAmount` carry the bond-side magnitude.
   */
  bondCurrency?: string;
  bondAmount?: number;
  counterparty: BondHistoryParty | null;
  bond: BondHistoryBondInfo | null;
}

interface BondHistoryResponse {
  entries: BondHistoryEntry[];
  page: number;
  pageSize: number;
  direction: BondHistoryDirection;
  totalTurns: number;
  pageCount: number;
  windowTurns: number;
}

/**
 * Fetches the corp's bond history, paginated by turn. Server-side direction
 * filter (`income | payment | all`) and page clamping mean the UI never sees
 * a "Page 3 of 5" state with no matching rows.
 *
 * @param refreshKey - reference change forces a refetch (parent passes a
 *   value that changes when the corp data is refreshed).
 *
 * Concurrency: every fetch (effect-driven OR manual `refresh()`) shares a
 * single in-flight AbortController held in a ref. Each new fetch aborts the
 * pending one before starting, so the latest call always wins state — no
 * out-of-order response can overwrite fresh data.
 */
export function useBondHistory(
  corpId: string,
  page: number,
  pageSize = 10,
  direction: BondHistoryDirection = "all",
  refreshKey: unknown = 0
) {
  const [entries, setEntries] = useState<BondHistoryEntry[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [totalTurns, setTotalTurns] = useState(0);
  const [windowTurns, setWindowTurns] = useState<number>(168);
  const [serverPage, setServerPage] = useState<number>(page);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single shared in-flight controller. Every fetch path (effect + manual
  // refresh) goes through `runFetch`, which aborts whatever's pending before
  // starting a new request.
  const inFlightRef = useRef<AbortController | null>(null);

  const runFetch = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    const { signal } = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/corporations/${corpId}/bonds/history?page=${page}&pageSize=${pageSize}&direction=${direction}`,
        { cache: "no-store", signal }
      );
      if (signal.aborted) return;
      if (!res.ok) throw new Error(`Failed to load bond history (HTTP ${res.status})`);
      const data: BondHistoryResponse = await res.json();
      if (signal.aborted) return;
      setEntries(data.entries);
      setPageCount(data.pageCount);
      setTotalTurns(data.totalTurns);
      setWindowTurns(data.windowTurns);
      setServerPage(data.page);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (signal.aborted) return;
      setError(e instanceof Error ? e.message : "Unknown error");
      setEntries([]);
    } finally {
      if (!signal.aborted) setLoading(false);
      // Clear the in-flight ref only if it still points at this controller —
      // a newer call may have replaced it already.
      if (inFlightRef.current === controller) inFlightRef.current = null;
    }
  }, [corpId, page, pageSize, direction]);

  useEffect(() => {
    void runFetch();
    return () => {
      // Effect cleanup aborts any pending fetch — on unmount or when deps
      // change before a request settles.
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
    // refreshKey is intentionally a dep so external changes re-run the fetch.
  }, [runFetch, refreshKey]);

  // `refresh` is stable across renders because it depends only on `runFetch`,
  // which is itself memoized. Safe to put in callers' useEffect deps.
  const refresh = useCallback(() => runFetch(), [runFetch]);

  return {
    entries,
    pageCount,
    totalTurns,
    windowTurns,
    serverPage,
    loading,
    error,
    refresh,
  };
}
