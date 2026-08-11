"use client";

import { useEffect, useState, useCallback } from "react";
import { GameHealthSummaryCards } from "./GameHealthSummaryCards";
import { GameHealthPopulationEconomy } from "./GameHealthPopulationEconomy";
import { GameHealthTrendChart } from "./GameHealthTrendChart";
import { GameHealthWarningsLog } from "./GameHealthWarningsLog";
import type { GameHealthSnapshot } from "@/lib/db/types";

export function GameHealthTab() {
  const [latest, setLatest] = useState<GameHealthSnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<GameHealthSnapshot[]>([]);
  const [cadence, setCadence] = useState(1);
  const [cadenceLoading, setCadenceLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [latestRes, snapshotsRes, settingsRes] = await Promise.all([
          fetch("/api/admin/health/snapshots/latest"),
          fetch("/api/admin/health/snapshots?limit=48"),
          fetch("/api/admin/health/settings"),
        ]);

        if (latestRes.ok) {
          const data = await latestRes.json();
          setLatest(data.snapshot);
        }
        if (snapshotsRes.ok) {
          const data = await snapshotsRes.json();
          setSnapshots(data.snapshots);
        }
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setCadence(data.integrityCheckCadenceTurns);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const updateCadence = useCallback(async (newCadence: number) => {
    setCadenceLoading(true);
    try {
      const res = await fetch("/api/admin/health/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrityCheckCadenceTurns: newCadence }),
      });
      if (res.ok) {
        setCadence(newCadence);
      }
    } finally {
      setCadenceLoading(false);
    }
  }, []);

  if (loading) {
    return <p className="text-sm text-muted">Loading game health data...</p>;
  }

  return (
    <div className="space-y-6">
      <GameHealthSummaryCards snapshot={latest} />
      <GameHealthPopulationEconomy snapshot={latest} />
      <GameHealthTrendChart snapshots={snapshots} />

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
        <span className="text-sm font-medium text-foreground">
          Data Integrity Check — Run every
        </span>
        <select
          value={cadence}
          onChange={(e) => updateCadence(Number(e.target.value))}
          disabled={cadenceLoading}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          {[1, 2, 4, 6, 12, 24, 48].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted">
          turn(s) — Last run: Turn {latest?.dataIntegrity?.lastCheckTurn ?? "—"}
        </span>
      </div>

      <GameHealthWarningsLog />
    </div>
  );
}
