"use client";

// ScoringConfigPanel (plan §4.8, admin-only): edit per-signal weights and the
// link/strong-link/cluster thresholds, with a LIVE preview of the effect on
// the currently-open cluster's confidence %. Save PUTs `/api/admin/alts/config`
// (admin-gated server-side). The preview recomputes ring confidence locally
// via `previewClusterConfidence` (faithful to `cluster.ts`), and crucially
// leaves guarded-to-zero signals immovable — so the panel demonstrates that no
// weight edit can resurrect a CF-edge IP or degenerate fingerprint.

import { useMemo, useState } from "react";
import { DEFAULT_ALT_SCORING_CONFIG } from "@/lib/altDetection/config";
import { ConfidenceMeter } from "./ConfidenceMeter";
import {
  formatPct,
  previewClusterConfidence,
  signalMeta,
  SIGNAL_META,
  TIER_HEX,
  TIER_LABEL,
  type AltConfig,
  type AltSignal,
  type AltSignalWeights,
  type AltScoringThresholds,
  type ClusterDetail,
  type SignalTier,
} from "./altTypes";
import type { ToastKind } from "./ModeratorActions";

interface ScoringConfigPanelProps {
  config: AltConfig;
  cluster: ClusterDetail | null;
  onSaved: (config: AltConfig) => void;
  notify: (msg: string, kind: ToastKind) => void;
}

const SIGNAL_ORDER = Object.keys(SIGNAL_META) as AltSignal[];
const THRESHOLD_KEYS: Array<{ key: keyof AltScoringThresholds; label: string; help: string }> = [
  {
    key: "link",
    label: "Link threshold",
    help: "Min pairwise confidence for an edge to join a cluster.",
  },
  {
    key: "strongLink",
    label: "Strong-link threshold",
    help: "Min edge confidence counted as a strong tie (role + ring confidence).",
  },
  {
    key: "cluster",
    label: "Auto-open threshold",
    help: "Min cluster confidence to surface in the open queue.",
  },
];

const GHOST_BTN_CLS =
  "inline-flex h-9 items-center rounded-lg border border-card-border px-3 text-sm transition-colors hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 motion-reduce:transition-none";

export function ScoringConfigPanel({ config, cluster, onSaved, notify }: ScoringConfigPanelProps) {
  const [weights, setWeights] = useState<AltSignalWeights>({ ...config.weights });
  const [thresholds, setThresholds] = useState<AltScoringThresholds>({ ...config.thresholds });
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(
    () =>
      SIGNAL_ORDER.some((s) => weights[s] !== config.weights[s]) ||
      (Object.keys(thresholds) as Array<keyof AltScoringThresholds>).some(
        (k) => thresholds[k] !== config.thresholds[k]
      ),
    [weights, thresholds, config]
  );

  const preview = useMemo(() => {
    if (!cluster) return null;
    return previewClusterConfidence(cluster.links, config.weights, weights, thresholds.strongLink);
  }, [cluster, config.weights, weights, thresholds.strongLink]);

  const delta = preview !== null && cluster ? preview - cluster.confidence : 0;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/alts/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weights, thresholds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const saved: AltConfig = {
        weights: (data.weights as AltSignalWeights) ?? weights,
        thresholds: (data.thresholds as AltScoringThresholds) ?? thresholds,
      };
      setWeights({ ...saved.weights });
      setThresholds({ ...saved.thresholds });
      onSaved(saved);
      notify("Scoring config saved. Applies on the next compute pass.", "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to save config", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 rounded-xl border border-card-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Scoring config
          </h3>
          <p className="mt-1 text-xs text-muted">
            Admin only. Weights feed the noisy-OR aggregate; guards are not editable.
          </p>
        </div>
        {cluster && preview !== null && (
          <div className="flex items-center gap-3 rounded-lg border border-card-border/70 bg-card-muted px-3 py-2">
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Live preview
              </div>
              <div className="text-xs tabular-nums text-muted">
                now {formatPct(cluster.confidence)} →{" "}
                <span
                  className={
                    delta > 0.001
                      ? "font-semibold text-red-400"
                      : delta < -0.001
                        ? "font-semibold text-emerald-400"
                        : ""
                  }
                >
                  {formatPct(preview)}
                </span>
              </div>
              {Math.abs(delta) > 0.001 && (
                <div
                  className={`text-[11px] font-medium tabular-nums ${delta > 0 ? "text-red-400" : "text-emerald-400"}`}
                >
                  {delta > 0 ? "+" : ""}
                  {Math.round(delta * 100)} pts
                </div>
              )}
            </div>
            <ConfidenceMeter value={preview} size="sm" />
          </div>
        )}
      </div>

      {!cluster && (
        <p className="rounded-lg border border-dashed border-card-border bg-card-muted/50 px-3 py-2.5 text-xs text-muted">
          Open a cluster to see edits preview against a live ring.
        </p>
      )}

      {/* Weights, grouped by tier so the hierarchy of proof reads at a glance. */}
      <div className="space-y-1">
        {SIGNAL_ORDER.map((sig, i) => {
          const meta = signalMeta(sig);
          const prevTier: SignalTier | null = i > 0 ? signalMeta(SIGNAL_ORDER[i - 1]).tier : null;
          const tierBreak = meta.tier !== prevTier;
          return (
            <div key={sig}>
              {tierBreak && (
                <div className={`flex items-center gap-2 px-2 pb-1.5 ${i === 0 ? "pt-0" : "pt-4"}`}>
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: TIER_HEX[meta.tier] }}
                  />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: TIER_HEX[meta.tier] }}
                  >
                    {TIER_LABEL[meta.tier]}
                  </span>
                  <span className="h-px flex-1 bg-card-border/60" aria-hidden />
                </div>
              )}
              <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-card-elevated/50 motion-reduce:transition-none">
                <div className="min-w-0">
                  <span className="truncate text-sm font-medium">{meta.label}</span>
                  {meta.guard && (
                    <p className="text-[11px] leading-relaxed text-emerald-400/80">
                      Guard: {meta.guard}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={weights[sig]}
                    onChange={(e) => setWeights((w) => ({ ...w, [sig]: Number(e.target.value) }))}
                    className="w-32 accent-primary"
                    aria-label={`${meta.label} weight`}
                  />
                  <span className="w-11 rounded-md bg-card-muted px-1.5 py-0.5 text-right font-mono text-xs font-semibold tabular-nums">
                    {weights[sig].toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Thresholds */}
      <div className="space-y-1 border-t border-card-border/70 pt-4">
        {THRESHOLD_KEYS.map(({ key, label, help }) => (
          <div
            key={key}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-card-elevated/50 motion-reduce:transition-none"
          >
            <div>
              <span className="text-sm font-medium">{label}</span>
              <p className="text-[11px] leading-relaxed text-muted">{help}</p>
            </div>
            <div className="flex items-center gap-2.5">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={thresholds[key]}
                onChange={(e) => setThresholds((t) => ({ ...t, [key]: Number(e.target.value) }))}
                className="w-32 accent-primary"
                aria-label={label}
              />
              <span className="w-11 rounded-md bg-card-muted px-1.5 py-0.5 text-right font-mono text-xs font-semibold tabular-nums">
                {thresholds[key].toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-card-border/70 pt-4">
        <button
          onClick={() => {
            setWeights({ ...DEFAULT_ALT_SCORING_CONFIG.weights });
            setThresholds({ ...DEFAULT_ALT_SCORING_CONFIG.thresholds });
          }}
          className={GHOST_BTN_CLS}
        >
          Reset to defaults
        </button>
        <button
          onClick={() => {
            setWeights({ ...config.weights });
            setThresholds({ ...config.thresholds });
          }}
          disabled={!dirty}
          className={GHOST_BTN_CLS}
        >
          Revert
        </button>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50 motion-reduce:transition-none"
        >
          {saving ? "Saving…" : "Save config"}
        </button>
      </div>
    </div>
  );
}
