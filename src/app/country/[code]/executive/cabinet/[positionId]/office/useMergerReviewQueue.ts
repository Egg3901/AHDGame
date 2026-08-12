"use client";

import { useCallback, useEffect, useState } from "react";
import type { MergerReviewSummary } from "@/components/mergerReview/MergerReviewCard";

export interface MergerReviewQueueData {
  /**
   * False when this country, in this era, has no competition seat, when the
   * economy is a command economy, or when the viewer does not hold the seat.
   * The caller renders nothing at all in that case rather than an empty state
   * that implies a duty which does not exist here.
   */
  applies: boolean;
  seatName?: string;
  countryId?: string;
  /** False when antitrust is at No Enforcement and only legacy referrals remain. */
  enforcementLive?: boolean;
  pending?: MergerReviewSummary[];
  decided?: MergerReviewSummary[];
}

/** Null means "leave the surface as it was": a transient failure, not an answer. */
async function fetchQueue(): Promise<MergerReviewQueueData | null> {
  try {
    const res = await fetch("/api/merger-reviews/queue");
    if (!res.ok) return { applies: false };
    return (await res.json()) as MergerReviewQueueData;
  } catch {
    return null;
  }
}

/**
 * The seated officeholder's national referral queue.
 *
 * `enabled` only avoids a pointless request from a seat that could not have a
 * queue. It is not a permission check: the endpoint re-resolves the seat from
 * `cabinetMembers` on every call and answers `applies: false` to anyone else.
 */
export function useMergerReviewQueue(enabled: boolean) {
  const [data, setData] = useState<MergerReviewQueueData | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      const next = await fetchQueue();
      if (alive && next) setData(next);
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const next = await fetchQueue();
    if (next) setData(next);
  }, [enabled]);

  return { data, refetch };
}
