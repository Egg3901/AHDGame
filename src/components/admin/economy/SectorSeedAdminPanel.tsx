"use client";

import { useState, useEffect } from "react";
import type { SeedPreviewResponse, SeedPreviewRow } from "@/lib/api/types/sectorSeed";

interface SeedResult {
  boostedCount: number;
  redirectedToNatCorpCount?: number;
  redirectBuckets?: number;
  log: string[];
  distressPreview?: { sectorType: string; boost: string }[];
}

interface FixPreview {
  dryRun: boolean;
  unownedAbsorbedCount: number;
  unownedRevenueTransferred: number;
  ownedSectorsMergedCount: number;
  ownedRevenueMerged: number;
  sampleKeys: string[];
}

function fixPreviewTotalItems(preview: FixPreview): number {
  return preview.unownedAbsorbedCount + preview.ownedSectorsMergedCount;
}

function fmtM(n: number) {
  if (Math.abs(n) >= 1_000_000_000) return `₳${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `₳${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `₳${(n / 1_000).toFixed(0)}K`;
  return `₳${n.toFixed(0)}`;
}

export function SectorSeedAdminPanel() {
  const [autoSeedEnabled, setAutoSeedEnabled] = useState<boolean | null>(null);
  const [togglingAutoSeed, setTogglingAutoSeed] = useState(false);

  const [maxBoostPct, setMaxBoostPct] = useState(100);
  const [preview, setPreview] = useState<SeedPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fixPreview, setFixPreview] = useState<FixPreview | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixConfirming, setFixConfirming] = useState(false);

  // Fetch flag state on mount via the dry-run endpoint (maxBoost=0 → no real boost data needed)
  useEffect(() => {
    void fetch("/api/admin/corporations/seed-unowned?maxBoost=0")
      .then((r) => r.json())
      .then((data: Partial<SeedPreviewResponse>) => {
        setAutoSeedEnabled(data.autoSectorSeedEnabled === true);
      })
      .catch(() => setAutoSeedEnabled(false));
  }, []);

  const handleToggleAutoSeed = async () => {
    const next = !autoSeedEnabled;
    if (
      !confirm(
        `${next ? "Enable" : "Disable"} automatic sector seeding?\n\n` +
          "When on, the turn engine applies a distress-weighted 0–25% boost to all " +
          "unowned sector revenue every 48 turns."
      )
    )
      return;
    setTogglingAutoSeed(true);
    try {
      const res = await fetch("/api/admin/auto-sector-seed/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await res.json()) as { autoSectorSeedEnabled?: boolean; error?: string };
      if (res.ok) {
        setAutoSeedEnabled(data.autoSectorSeedEnabled === true);
        setMessage(
          data.autoSectorSeedEnabled
            ? "Auto sector seeding enabled"
            : "Auto sector seeding disabled"
        );
      } else {
        setMessage(data.error ?? "Failed to toggle auto sector seeding");
      }
    } catch {
      setMessage("Failed to toggle auto sector seeding");
    } finally {
      setTogglingAutoSeed(false);
    }
  };

  const handleSliderChange = (val: number) => {
    setMaxBoostPct(val);
    setPreview(null);
    setConfirming(false);
    setResult(null);
    setPreviewError(null);
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    setConfirming(false);
    try {
      const res = await fetch(`/api/admin/corporations/seed-unowned?maxBoost=${maxBoostPct / 100}`);
      const json = (await res.json()) as SeedPreviewResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPreview(json);
      setAutoSeedEnabled(json.autoSectorSeedEnabled);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSeed = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/corporations/seed-unowned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxBoost: maxBoostPct / 100 }),
      });
      const json = (await res.json()) as SeedResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult(json);
      setConfirming(false);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleFixPreview = async () => {
    setFixLoading(true);
    setFixPreview(null);
    setFixConfirming(false);
    try {
      const res = await fetch("/api/admin/corporations/heal-captured-unowned");
      const json = (await res.json()) as FixPreview & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setFixPreview(json);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Fix preview failed");
    } finally {
      setFixLoading(false);
    }
  };

  const handleFix = async () => {
    setFixLoading(true);
    try {
      const res = await fetch("/api/admin/corporations/heal-captured-unowned", {
        method: "POST",
      });
      const json = (await res.json()) as FixPreview & { success?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setFixPreview(json);
      setFixConfirming(false);
      setMessage(
        `Fixed captured markets — ${json.unownedAbsorbedCount} unowned absorbed, ${json.ownedSectorsMergedCount} player sectors merged into national corporations`
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Fix failed");
    } finally {
      setFixLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header + auto-seed toggle */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold mb-1">Distress-Weighted Sector Seed</h3>
          <p className="text-xs text-muted max-w-xl">
            Boosts unowned sector revenue based on economic distress signals (commodity price
            ratios, supply/demand). The most-distressed sectors get the full max boost; healthiest
            get ~0. Missing sector docs are created. Captured markets seed directly into the
            National Corporation. Irreversible — preview first.
          </p>
        </div>
        <button
          onClick={handleToggleAutoSeed}
          disabled={togglingAutoSeed || autoSeedEnabled === null}
          className={`shrink-0 rounded border px-3 py-1.5 text-xs transition-colors ${
            autoSeedEnabled
              ? "border-success/50 bg-success/10 text-success hover:bg-success/20"
              : "border-card-border bg-card text-muted hover:bg-background/60"
          }`}
          title="When on, applies a distress-weighted 0–25% boost every 48 turns automatically"
        >
          Auto-Seed: {autoSeedEnabled === null ? "…" : autoSeedEnabled ? "On" : "Off"}
        </button>
      </div>

      {message && (
        <p className="text-xs text-muted bg-background/60 border border-card-border rounded px-3 py-2">
          {message}{" "}
          <button
            onClick={() => setMessage(null)}
            className="text-muted hover:text-foreground ml-2"
          >
            ×
          </button>
        </p>
      )}

      {/* Manual boost slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted font-medium">
            Max boost for most-distressed sectors (one-time)
          </label>
          <span className="text-sm font-semibold tabular-nums">{maxBoostPct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={300}
          step={5}
          value={maxBoostPct}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[10px] text-muted">
          <span>0%</span>
          <span>100%</span>
          <span>200%</span>
          <span>300%</span>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handlePreview}
          disabled={previewLoading || maxBoostPct === 0}
          className="text-xs px-3 py-1.5 rounded border border-card-border hover:bg-background/60 transition-colors disabled:opacity-40"
        >
          {previewLoading ? "Loading…" : "Dry Run"}
        </button>
        {preview && !result && (
          <button
            onClick={() => setConfirming((c) => !c)}
            className="text-xs px-3 py-1.5 rounded border border-warning/40 text-warning hover:bg-warning/10 transition-colors"
          >
            Seed Underdeveloped Sectors ({maxBoostPct}% max)
          </button>
        )}
      </div>

      {previewError && (
        <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{previewError}</p>
      )}

      {preview && <PreviewTable preview={preview} />}

      {confirming && (
        <div className="flex items-center gap-3 rounded-lg bg-warning/10 border border-warning/30 px-4 py-3 text-sm">
          <span className="text-warning font-medium">
            Apply up to {maxBoostPct}% boost (distress-weighted) to all unowned sectors?
            Irreversible.
          </span>
          <button
            onClick={handleSeed}
            disabled={loading}
            className="px-3 py-1 rounded bg-warning text-warning-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Seeding…" : "Confirm"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-xs text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{error}</p>}

      {result && (
        <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3 space-y-2">
          <p className="text-sm text-success font-medium">
            Done — {result.boostedCount} sector docs boosted
            {typeof result.redirectedToNatCorpCount === "number" &&
            result.redirectedToNatCorpCount > 0
              ? `, ${result.redirectedToNatCorpCount} routed to national corporations`
              : ""}
            .
          </p>
          {result.log?.map((l, i) => (
            <p key={i} className="text-xs text-muted">
              {l}
            </p>
          ))}
          <button
            onClick={() => setResult(null)}
            className="text-xs text-muted hover:text-foreground pt-1"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="rounded-xl border border-card-border bg-card px-4 py-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold mb-1">Fix Captured Markets</h4>
          <p className="text-xs text-muted max-w-xl">
            Repairs national-corporation-captured markets: absorbs erroneous unowned revenue and
            merges player/NPC sectors only where enacted law authorized corp takings (not
            unowned-only sweeps). Restores market share and GDP growth weighting. Preview first.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleFixPreview}
            disabled={fixLoading}
            className="text-xs px-3 py-1.5 rounded border border-card-border hover:bg-background/60 transition-colors disabled:opacity-40"
          >
            {fixLoading && !fixConfirming ? "Loading…" : "Preview Fix"}
          </button>
          {fixPreview && fixPreviewTotalItems(fixPreview) > 0 && !fixConfirming && (
            <button
              onClick={() => setFixConfirming(true)}
              className="text-xs px-3 py-1.5 rounded border border-warning/40 text-warning hover:bg-warning/10 transition-colors"
            >
              Fix {fixPreviewTotalItems(fixPreview)} items
            </button>
          )}
        </div>
        {fixPreview && (
          <p className="text-xs text-muted">
            {fixPreviewTotalItems(fixPreview) === 0
              ? "No captured-market issues found."
              : [
                  fixPreview.unownedAbsorbedCount > 0
                    ? `${fixPreview.unownedAbsorbedCount} unowned (${fmtM(fixPreview.unownedRevenueTransferred)})`
                    : null,
                  fixPreview.ownedSectorsMergedCount > 0
                    ? `${fixPreview.ownedSectorsMergedCount} player sectors (${fmtM(fixPreview.ownedRevenueMerged)})`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") +
                " to merge into national corporations" +
                (fixPreview.sampleKeys.length > 0
                  ? ` — e.g. ${fixPreview.sampleKeys.slice(0, 4).join(", ")}`
                  : "")}
            .
          </p>
        )}
        {fixConfirming && fixPreview && (
          <div className="flex items-center gap-3 rounded-lg bg-warning/10 border border-warning/30 px-4 py-3 text-sm">
            <span className="text-warning font-medium">
              Fix {fixPreviewTotalItems(fixPreview)} captured-market items (unowned + player
              sectors)? Irreversible.
            </span>
            <button
              onClick={handleFix}
              disabled={fixLoading}
              className="px-3 py-1 rounded bg-warning text-warning-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {fixLoading ? "Fixing…" : "Confirm Fix"}
            </button>
            <button
              onClick={() => setFixConfirming(false)}
              className="text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewTable({ preview }: { preview: SeedPreviewResponse }) {
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">
          Dry Run Preview — {preview.totalDocs} docs
        </span>
        <span className="text-sm font-semibold text-success">
          +{fmtM(preview.totalProjectedDelta)} total injection
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-background/50">
            <tr>
              {["Sector", "Boost", "Current (all states)", "Delta"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 text-left text-[10px] font-medium text-muted uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {preview.rows.map((row: SeedPreviewRow) => (
              <tr key={row.sectorType} className="hover:bg-background/40">
                <td className="px-4 py-2 font-medium">{row.sectorType}</td>
                <td className="px-4 py-2 tabular-nums">
                  <span
                    className={
                      row.boostPct > 15
                        ? "text-success font-semibold"
                        : row.boostPct > 0
                          ? "text-foreground"
                          : "text-muted"
                    }
                  >
                    +{row.boostPct}%
                  </span>
                </td>
                <td className="px-4 py-2 tabular-nums text-muted">{fmtM(row.currentRevenue)}</td>
                <td className="px-4 py-2 tabular-nums">
                  {row.projectedDelta > 0 ? (
                    <span className="text-success">+{fmtM(row.projectedDelta)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-background/30 border-t border-card-border font-semibold">
            <tr>
              <td className="px-4 py-2" colSpan={2}>
                Total
              </td>
              <td className="px-4 py-2 tabular-nums">{fmtM(preview.totalCurrentRevenue)}</td>
              <td className="px-4 py-2 tabular-nums text-success">
                +{fmtM(preview.totalProjectedDelta)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
