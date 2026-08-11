"use client";

import { useEffect, useState, useCallback } from "react";

export interface ShareHistoryParty {
  characterId?: string;
  imperialCharacterId?: string;
  corporationId?: string;
  name: string;
}

export interface ShareHistoryStructureChangeHolder {
  kind: "character" | "imperial" | "corporation" | "fund" | "public_float";
  ownerId?: string;
  name: string;
  shares: number;
  percent: number;
}

export interface ShareHistoryStructureChange {
  oldTotalShares: number;
  newTotalShares: number;
  oldSharePriceLocal: number;
  newSharePriceLocal: number;
  oldPublicFloat: number;
  newPublicFloat: number;
  triggeredByCharacterId?: string;
  before: ShareHistoryStructureChangeHolder[];
  after: ShareHistoryStructureChangeHolder[];
}

export interface ShareHistoryEntry {
  id: string;
  kind:
    | "issuance"
    | "market_buy"
    | "market_sell"
    | "limit_fill"
    | "peer_fill"
    | "listing_fill"
    | "takeover_buyout"
    | "correction"
    | "stock_split"
    | "reverse_split";
  turn: number;
  createdAt: string;
  shares: number;
  pricePerShareAnchor: number;
  totalAnchor: number;
  corpCurrencyCode?: string;
  from: ShareHistoryParty | null;
  to: ShareHistoryParty | null;
  note?: string;
  structureChange?: ShareHistoryStructureChange | null;
}

interface ShareHistoryResponse {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  entries: ShareHistoryEntry[];
}

export function useShareHistory(corpId: string, page: number, pageSize = 25) {
  const [entries, setEntries] = useState<ShareHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/corporations/${corpId}/shares/history?page=${page}&pageSize=${pageSize}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error(`Failed to load share history (HTTP ${res.status})`);
      }
      const data: ShareHistoryResponse = await res.json();
      setEntries(data.entries);
      setTotal(data.total);
      setPageCount(data.pageCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setEntries([]);
      setTotal(0);
      setPageCount(1);
    } finally {
      setLoading(false);
    }
  }, [corpId, page, pageSize]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  return { entries, total, pageCount, loading, error, refresh: fetchPage };
}
