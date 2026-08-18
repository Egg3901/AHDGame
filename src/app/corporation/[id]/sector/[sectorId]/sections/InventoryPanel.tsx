"use client";

import { useEffect, useState } from "react";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { CommodityType } from "@/lib/constants/commodities";

interface InventoryPanelProps {
  corporationId: string;
  sectorId: string;
  isCeo: boolean;
  inventory: {
    stockpileUnsold: boolean;
    heldUnits: number;
    heldValueAnchor: number;
    byCommodity: { commodity: string; units: number }[];
    drainedUnits: number;
    spoiledUnits: number;
  };
}

const fmt = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : n.toFixed(0);

/**
 * Sell-all vs build-inventory (design-realization-legs §6). With the toggle
 * on, unsold storable output goes into a warehouse pile instead of being lost;
 * the pile spoils a little each turn, costs a little to hold, and sells when
 * the market clears the sector's fresh output in full. Storage is not free, so
 * holding forever loses money against selling.
 */
export default function InventoryPanel({
  corporationId,
  sectorId,
  isCeo,
  inventory,
}: InventoryPanelProps) {
  const [enabled, setEnabled] = useState(inventory.stockpileUnsold);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resync when the parent refetches: another officer may have flipped the
  // toggle, and a stale useState initial value would show the opposite state
  // until a full remount.
  useEffect(() => {
    setEnabled(inventory.stockpileUnsold);
  }, [inventory.stockpileUnsold]);

  const toggle = async () => {
    const nextValue = !enabled;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/sectors/${sectorId}/stockpile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockpileUnsold: nextValue }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to update");
      }
      setEnabled(nextValue);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  if (!isCeo && inventory.heldUnits <= 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Unsold output</h3>
          <p className="mt-0.5 text-xs text-muted">
            {enabled
              ? "Unsold storable goods go into inventory and sell when the market has room. The pile spoils a little each turn and costs money to hold."
              : "Unsold output is lost at the end of each turn. Turn stockpiling on to keep storable goods and sell them when the market has room."}
          </p>
        </div>
        {isCeo && (
          <button
            type="button"
            onClick={toggle}
            disabled={saving}
            aria-pressed={enabled}
            aria-busy={saving}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              enabled
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-background text-muted hover:text-foreground"
            } ${saving ? "opacity-60" : ""}`}
          >
            {enabled ? "Stockpiling on" : "Stockpiling off"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {error}
        </p>
      )}
      {inventory.heldUnits > 0 && (
        <div className="mt-3 text-xs text-muted">
          <p>
            Holding <span className="font-medium text-foreground">{fmt(inventory.heldUnits)}</span>{" "}
            units worth{" "}
            <span className="font-medium text-foreground">₳ {fmt(inventory.heldValueAnchor)}</span>
            {inventory.drainedUnits > 0 && <> · sold {fmt(inventory.drainedUnits)} last turn</>}
            {inventory.spoiledUnits > 0 && <> · spoiled {fmt(inventory.spoiledUnits)} last turn</>}
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {inventory.byCommodity.map((row) => (
              <li key={row.commodity} className="tabular-nums">
                {COMMODITY_LABELS[row.commodity as CommodityType] ?? row.commodity}:{" "}
                {fmt(row.units)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
