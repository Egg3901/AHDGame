"use client";

import { useState, useEffect, useCallback } from "react";
import type { MyShareOrder, MarketOrder, UseShareOrdersReturn } from "../types";

export function useShareOrders(corpId: string): UseShareOrdersReturn {
  const [myOrders, setMyOrders] = useState<MyShareOrder[]>([]);
  const [marketOrders, setMarketOrders] = useState<MarketOrder[]>([]);
  const [fillAmounts, setFillAmounts] = useState<Record<string, number>>({});

  const refreshOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/orders`);
      if (res.ok) {
        const data = await res.json();
        if (data.myOrders) setMyOrders(data.myOrders);
        if (data.marketOrders) setMarketOrders(data.marketOrders);
      }
    } catch {
      // silently fail
    }
  }, [corpId]);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await fetch(`/api/corporations/${corpId}/shares/orders`);
        if (res.ok) {
          const data = await res.json();
          if (data.myOrders) setMyOrders(data.myOrders);
          if (data.marketOrders) setMarketOrders(data.marketOrders);
        }
      } catch {
        // silently fail
      }
    };
    fetchOrders();
  }, [corpId]);

  return {
    myOrders,
    marketOrders,
    fillAmounts,
    setFillAmounts,
    refreshOrders,
  };
}
