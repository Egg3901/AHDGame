"use client";

import { useState, useEffect, useCallback } from "react";
import {
  MARKET_MODE_INFO as MODE_INFO,
  MARKET_MODE_ORDER as MODE_ORDER,
  type MarketSystemMode as MarketMode,
} from "@/lib/market/modes";

interface MarketFlags {
  scarcityDriftEnabled: boolean;
  stockCoverCapEnabled: boolean;
  brandLoyaltyEnabled: boolean;
  brandLoyaltySliceEnabled: boolean;
  sectorQualityEnabled: boolean;
  supplyAgreementsEnabled: boolean;
  shortageResponsiveSourcingEnabled: boolean;
  extractionOutputScaleEnabled: boolean;
}

const FEATURE_TOGGLES: Array<{
  key: keyof MarketFlags;
  label: string;
  description: string;
  requires?: keyof MarketFlags;
}> = [
  {
    key: "brandLoyaltyEnabled",
    label: "Brand loyalty",
    description:
      "Per-turn loyalty accrual from pricing consistency and delivery. Safe to enable alone (shadow accrual).",
  },
  {
    key: "brandLoyaltySliceEnabled",
    label: "Loyalty slice in clearing",
    description:
      "Second-stage gate: loyal customers reserve demand before cheapest-first clearing. Requires brand loyalty on.",
    requires: "brandLoyaltyEnabled",
  },
  {
    key: "sectorQualityEnabled",
    label: "Output quality",
    description:
      "Four-pillar quality per sector, rolled up to corp average and commodity propagation.",
  },
  {
    key: "supplyAgreementsEnabled",
    label: "Supply agreements",
    description: "CEO bilateral off-market commodity contracts (requires clearing for fills).",
  },
  {
    key: "scarcityDriftEnabled",
    label: "Scarcity price drift",
    description: "Persistent supply/demand imbalance ratchets commodity prices over time.",
  },
  {
    key: "shortageResponsiveSourcingEnabled",
    label: "Shortage-responsive sourcing",
    description:
      "Dark rollout: severely short states accept higher landed prices. Enable only after a controlled simulation report.",
  },
  {
    key: "stockCoverCapEnabled",
    label: "Stock cover cap",
    description: "Accelerated spoilage on shadow stock above cover cap (legacy overhang defusal).",
  },
  {
    key: "extractionOutputScaleEnabled",
    label: "Extraction output scale",
    description:
      "Structural extraction-shortage stabilizer (audit t873): lifts per-resource extraction supply (copper/rare earth 2.5×, gas 2×, iron 1.8×, timber 1.6×, oil 1.4×) to neutralize the chronic extractable shortage. Calibration stabilizer, not the durable fix. Copper's 2.5× predates the manual copper-titan boost — re-check EXTRACTION_OUTPUT_SCALE before enabling.",
  },
];

export function MarketAdminPanel() {
  const [mode, setMode] = useState<MarketMode | null>(null);
  const [flags, setFlags] = useState<MarketFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/config/market");
      if (res.ok) {
        const data = (await res.json()) as { mode: MarketMode } & MarketFlags;
        setMode(data.mode);
        setFlags({
          scarcityDriftEnabled: data.scarcityDriftEnabled === true,
          stockCoverCapEnabled: data.stockCoverCapEnabled === true,
          brandLoyaltyEnabled: data.brandLoyaltyEnabled === true,
          brandLoyaltySliceEnabled: data.brandLoyaltySliceEnabled === true,
          sectorQualityEnabled: data.sectorQualityEnabled === true,
          supplyAgreementsEnabled: data.supplyAgreementsEnabled === true,
          shortageResponsiveSourcingEnabled: data.shortageResponsiveSourcingEnabled === true,
          extractionOutputScaleEnabled: data.extractionOutputScaleEnabled === true,
        });
        setError("");
      } else {
        setError(`Couldn't load the current market mode (HTTP ${res.status}).`);
      }
    } catch {
      setError("Couldn't load the current market mode (network error).");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const patchConfig = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/config/market", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error || "Failed to update settings");
        return;
      }
      await fetchStatus();
      return true;
    } catch {
      setError("Network error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSetMode = async (newMode: MarketMode) => {
    if (mode === null || mode === newMode) return;
    const ok = await patchConfig({ mode: newMode });
    if (ok) setMessage(`Market system set to "${newMode}".`);
  };

  const handleToggleFlag = async (key: keyof MarketFlags) => {
    if (!flags || !mode) return;
    const next = !flags[key];
    const body: Record<string, unknown> = { mode, [key]: next };
    if (key === "brandLoyaltyEnabled" && !next) {
      body.brandLoyaltySliceEnabled = false;
    }
    const ok = await patchConfig(body);
    if (ok) {
      const toggle = FEATURE_TOGGLES.find((f) => f.key === key);
      setMessage(`${toggle?.label ?? key} ${next ? "enabled" : "disabled"}.`);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading market settings…</span>
        </div>
      </div>
    );
  }

  const currentMode = mode ?? "off";
  const modeUnknown = mode === null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Market system</h3>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
              modeUnknown
                ? "bg-destructive/15 text-destructive"
                : currentMode === "off"
                  ? "bg-warning/15 text-warning"
                  : "bg-success/15 text-success"
            }`}
          >
            {modeUnknown ? "Unknown" : MODE_INFO[currentMode].label}
          </span>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          {MODE_INFO[currentMode].description} Graduated — each tier is a superset of the previous.
          Enable clearing or higher for posted pricing; ledger for stockpile visibility.
        </p>

        {error ? (
          <p className="mb-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mb-3 text-xs text-success" role="status">
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => void handleSetMode(m)}
              disabled={saving || modeUnknown || currentMode === m || !MODE_INFO[m].live}
              title={MODE_INFO[m].description}
              className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                currentMode === m
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-card-border bg-background hover:bg-card"
              }`}
            >
              {MODE_INFO[m].label}
              {!MODE_INFO[m].live ? (
                <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted">soon</span>
              ) : null}
            </button>
          ))}
        </div>

        <ul className="mt-4 space-y-1.5 border-t border-card-border pt-3">
          {MODE_ORDER.map((m) => (
            <li key={m} className="flex gap-2 text-xs leading-relaxed">
              <span
                className={`w-20 shrink-0 font-semibold ${
                  currentMode === m ? "text-primary" : "text-foreground"
                }`}
              >
                {MODE_INFO[m].label}
                {!MODE_INFO[m].live ? " *" : ""}
              </span>
              <span className="text-muted">{MODE_INFO[m].description}</span>
            </li>
          ))}
          <li className="text-[10px] text-muted pt-1">* not implemented yet — button disabled.</li>
        </ul>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <h3 className="text-sm font-semibold">Premium & loyalty features</h3>
        <p className="mt-1 mb-4 text-xs text-muted">
          Package A/B market mechanics — toggled independently of the mode ladder. Posted pricing
          requires clearing; supply agreements fill before open-market clearing when enabled.
        </p>

        <div className="space-y-3">
          {FEATURE_TOGGLES.map((toggle) => {
            const enabled = flags?.[toggle.key] === true;
            const blocked = toggle.requires && flags?.[toggle.requires] !== true;
            return (
              <div
                key={toggle.key}
                className="flex items-start justify-between gap-4 rounded-lg border border-card-border bg-background p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{toggle.label}</div>
                  <p className="mt-0.5 text-xs text-muted">{toggle.description}</p>
                  {blocked && (
                    <p className="mt-1 text-[11px] text-warning">
                      Enable {FEATURE_TOGGLES.find((f) => f.key === toggle.requires)?.label} first.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={saving || modeUnknown || !!blocked}
                  onClick={() => void handleToggleFlag(toggle.key)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                    enabled ? "bg-primary" : "bg-card-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      enabled ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
