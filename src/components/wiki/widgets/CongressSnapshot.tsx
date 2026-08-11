// src/components/wiki/widgets/CongressSnapshot.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface CongressData {
  house: Record<string, number>;
  senate: Record<string, number>;
  lastUpdated: string;
}

export function CongressSnapshot() {
  const [data, setData] = useState<CongressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/wiki/live-stats");
        if (!res.ok) throw new Error("Failed to fetch");
        const stats = await res.json();
        setData(stats.congress);
        setError(null);
      } catch {
        setError("Unable to load live data");
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
    const interval = setInterval(fetchStats, 120000); // Refresh every 2 min
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card/40 p-6">
        <div className="h-32 animate-pulse space-y-3">
          <div className="h-4 w-32 rounded bg-card-elevated"></div>
          <div className="h-6 w-48 rounded bg-card-elevated"></div>
          <div className="h-6 w-48 rounded bg-card-elevated"></div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-card-border bg-card/40 p-6">
        <p className="text-sm text-muted">{error || "No data available"}</p>
      </div>
    );
  }

  const formatCounts = (counts: Record<string, number>) => {
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([party, count]) => `${party} ${count}`)
      .join(" | ");
  };

  const lastUpdated = new Date(data.lastUpdated);
  const minutesAgo = Math.floor((Date.now() - lastUpdated.getTime()) / 60000);

  return (
    <Link
      href="/congress"
      className="group block rounded-xl border border-card-border bg-card/40 p-6 transition-colors hover:border-primary/40 hover:bg-card/60"
    >
      <h3 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
        <span>🏛️</span>
        <span>Current Congress</span>
      </h3>
      <div className="space-y-2 text-sm">
        <div>
          <span className="font-medium text-foreground">House: </span>
          <span className="text-muted">{formatCounts(data.house)}</span>
        </div>
        <div>
          <span className="font-medium text-foreground">Senate: </span>
          <span className="text-muted">{formatCounts(data.senate)}</span>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">
        Updated {minutesAgo === 0 ? "just now" : `${minutesAgo} min ago`}
      </p>
    </Link>
  );
}
