"use client";

import { useEffect, useState } from "react";
import {
  MergerReviewCard,
  type MergerReviewSummary,
} from "@/components/mergerReview/MergerReviewCard";

interface MergerReviewResponse {
  involving: MergerReviewSummary[];
}

/**
 * Merger review as the CEO sees it: the referrals this player's corporations
 * are caught in, and nothing else.
 *
 * Deciding referrals is the competition officeholder's job and lives on their
 * cabinet office page. It used to be bolted onto this panel, which meant the
 * only route to a national duty ran through some corporation's Deals tab, and
 * meant a seated minister who ran no corporation could not reach their own
 * work at all.
 */
export default function MergerReviewPanel() {
  const [data, setData] = useState<MergerReviewResponse | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/merger-reviews");
        const d = await res.json();
        if (alive && res.ok) setData(d);
      } catch {
        // Transient; the panel simply stays as it was.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!data || data.involving.length === 0) return null;

  return (
    <section className="min-w-0">
      <div className="flex min-h-8 items-baseline gap-2 border-b border-card-border pb-1.5">
        <h2 className="text-sm font-semibold text-foreground">Merger review</h2>
        <p className="text-xs text-muted">deals of yours that competition policy has touched</p>
      </div>
      <ul className="divide-y divide-card-border/60">
        {data.involving.map((review) => (
          <MergerReviewCard key={review.id} review={review} />
        ))}
      </ul>
    </section>
  );
}
