"use client";

import { useState } from "react";
import { regionPartyApiUrl } from "@/lib/urls";
import { useToast } from "@/contexts/ToastContext";
import { Tooltip } from "@/components/ui";
import {
  BUILD_ORG_BASE_PS_COST,
  STATE_PS_CAP_DEFAULT,
} from "@/lib/politicalStrength/strengthConstants";
import {
  FactorsExplainer,
  type BuildOrgFactors,
} from "@/components/state/politics/FactorBreakdown";
import { EstimateBox } from "./EstimateBox";
import { PsSpendButtons } from "./PsSpendButtons";
import { usePsSpendScope } from "./usePsSpendScope";
import { useActionPreview } from "./useActionPreview";

interface BuildOrgPanelProps {
  countryCode: string;
  stateId: string;
  partyId: string;
  partyColor: string;
  /** Spender's current state PS reserve (drives the insufficient-PS gate). */
  ps: number;
  /** Whether the party has a player/elected official here (false blocks Build Org). */
  hasPresence: boolean;
  /** Whether the viewer may spend PS for this state party. */
  canBuildOrg: boolean;
  /** Re-fetch hook so the parent surface refreshes after a successful click. */
  onSuccess: () => void;
  /** Compact card styling for the State Politics tab; default = full tile. */
  compact?: boolean;
  /** Effective state PS cap denominator (7.5 for NPP-only parties, else 30). */
  effectiveCap?: number;
}

interface PoachLine {
  partyId: string;
  loss: number;
  /** Present on the post-click result (rival's Org after the poach); absent on preview. */
  newOrg?: number;
  partyName?: string;
  abbreviation?: string;
}

interface BuildOrgResult {
  psCost: number;
  orgGain: number;
  factors: BuildOrgFactors;
  poaches?: PoachLine[];
}

type BuildOrgPreview =
  | {
      ok: true;
      effectiveCost: number;
      pressureValue: number;
      projectedGain: number;
      poaches?: PoachLine[];
      factors: BuildOrgFactors;
      scope: "state" | "national-targeted";
    }
  | { ok: false; reason: string; message: string };

/**
 * Surface-agnostic Build Org panel. Spends Political Strength to grow the
 * party's Org% in this state; gain scales with the unaffiliated pool, the
 * spender's PS reserve vs rivals, own-Org diminishing returns, and a catch-up
 * bonus. Renders on the region→party Overview (full) and the State Politics tab
 * (compact). Estimate + factor breakdown via the shared `EstimateBox`.
 */
export function BuildOrgPanel({
  countryCode,
  stateId,
  partyId,
  partyColor,
  ps,
  hasPresence,
  canBuildOrg,
  onSuccess,
  compact = false,
  effectiveCap = STATE_PS_CAP_DEFAULT,
}: BuildOrgPanelProps) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [bumpKey, setBumpKey] = useState(0);
  const [lastResult, setLastResult] = useState<BuildOrgResult | null>(null);

  const apiUrl = regionPartyApiUrl(countryCode, stateId, partyId);
  const { eligibleScopes, poolPS } = usePsSpendScope(countryCode, stateId, partyId, canBuildOrg);
  const { preview, loading: previewLoading } = useActionPreview<BuildOrgPreview>(
    `${apiUrl}/build-org/preview`,
    { enabled: true, refetchKey: bumpKey }
  );

  const handleClick = async (psPool?: "state" | "national") => {
    setBusy(true);
    try {
      const r = await fetch(`${apiUrl}/build-org`, {
        method: "POST",
        headers: psPool ? { "Content-Type": "application/json" } : undefined,
        body: psPool ? JSON.stringify({ psPool }) : undefined,
      });
      const d = await r.json();
      if (!r.ok) {
        showToast(d.error ?? "Build Org failed", "error");
        return;
      }
      setLastResult(d as BuildOrgResult);
      setBumpKey((k) => k + 1);
      showToast(
        `+${(d.orgGain as number).toFixed(2)} Org for ${(d.psCost as number).toFixed(0)} PS`,
        "success"
      );
      onSuccess();
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusy(false);
    }
  };

  const paysFromNationalPool = preview?.ok === true && preview.scope === "national-targeted";
  const insufficientPs = !paysFromNationalPool && ps < BUILD_ORG_BASE_PS_COST;
  const noPresence = !hasPresence;

  const statePoolInsufficient = (poolPS?.statePoolPS ?? ps) < BUILD_ORG_BASE_PS_COST;
  const nationalPoolInsufficient = (poolPS?.nationalPoolPS ?? 0) < BUILD_ORG_BASE_PS_COST;

  const buttonAnim = bumpKey > 0 ? "ps-bloom" : "";
  const counterAnim = bumpKey > 0 ? "ps-counter-pulse" : "";
  const tileAnim = bumpKey > 0 ? "ps-row-flash" : "";

  const buttons = (
    <PsSpendButtons
      scopes={eligibleScopes}
      color={partyColor}
      busy={busy}
      label="Build Org"
      busyLabel="Building…"
      singleDisabled={!canBuildOrg || insufficientPs || noPresence}
      stateDisabled={!canBuildOrg || statePoolInsufficient || noPresence}
      nationalDisabled={!canBuildOrg || nationalPoolInsufficient || noPresence}
      singleTitle={
        !canBuildOrg
          ? "Only the party chair, vice chair, or admin can build org"
          : noPresence
            ? "Establish a player or elected official in this state first"
            : insufficientPs
              ? `Need ${BUILD_ORG_BASE_PS_COST} PS minimum`
              : "Spend PS to grow Org in this state"
      }
      stateTitle={`Spend from state pool${poolPS ? ` (${poolPS.statePoolPS.toFixed(0)} PS)` : ""}`}
      nationalTitle={`Spend from national pool${poolPS ? ` (${poolPS.nationalPoolPS.toFixed(0)} PS)` : ""}`}
      buttonAnim={buttonAnim}
      onSpend={handleClick}
    />
  );

  const estimate = lastResult ? (
    <EstimateBox
      variant="last"
      tone="build"
      cost={{ effectivePS: lastResult.psCost, basePS: lastResult.psCost, ladderPS: 0 }}
      gain={{ label: "Gain", value: lastResult.orgGain, sign: "+", unit: "Org" }}
      factors={lastResult.factors}
    />
  ) : preview && preview.ok ? (
    <EstimateBox
      variant="projection"
      tone="build"
      cost={{
        effectivePS: preview.effectiveCost,
        basePS: BUILD_ORG_BASE_PS_COST,
        ladderPS: Math.max(0, preview.effectiveCost - BUILD_ORG_BASE_PS_COST),
      }}
      gain={{ label: "Estimated Gain", value: preview.projectedGain, sign: "+", unit: "Org" }}
      factors={preview.factors}
    />
  ) : preview && !preview.ok ? (
    <div className="rounded-lg border border-card-border/40 bg-background/30 px-4 py-3">
      <div className="text-[11px] italic text-muted">{preview.message}</div>
    </div>
  ) : (
    <div className="rounded-lg border border-card-border/40 bg-background/30 px-4 py-3">
      {previewLoading ? (
        <div className="text-[11px] italic text-muted">Loading projection…</div>
      ) : (
        <FactorsExplainer />
      )}
    </div>
  );

  return (
    <div
      key={`build-org-${bumpKey}`}
      className={`rounded-xl border border-card-border bg-card overflow-hidden ${tileAnim}`}
      style={{ "--ps-flash-color": "rgba(34, 197, 94, 0.18)" } as React.CSSProperties}
    >
      <div
        className={`flex items-start justify-between gap-4 ${compact ? "px-4 pt-4 pb-2" : "px-6 pt-5 pb-3"}`}
        style={{ borderBottom: `3px solid ${partyColor}30` }}
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <svg
              className="h-4 w-4 text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h2 className={compact ? "text-sm font-semibold" : "font-semibold"}>Build Org</h2>
            <Tooltip
              label="About Build Org"
              content="Spend Political Strength (PS) to grow your Org% in this state. Each click claims unaffiliated pool first, then poaches rivals. Bigger Org and lower rival PS make a rival a larger target."
            />
          </div>
          {compact ? null : (
            <p className="text-xs text-muted/70 leading-relaxed max-w-lg">
              Grow your share of the statewide Org pool. Cost rises with per-state pressure; gain
              comes from open (unaffiliated) pool plus automatic rival poaching.
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center justify-end text-[10px] uppercase tracking-wider text-muted">
            Your PS
            <Tooltip
              label="About Political Strength"
              content="Political Strength (PS) reserve for this state party. Build Org spends from the state pool (or national pool if you have that authority). Cap shown is the effective max."
            />
          </div>
          <div
            key={`ps-${bumpKey}`}
            className={`font-bold tabular-nums ${compact ? "text-lg" : "text-2xl"} ${counterAnim}`}
            style={{ color: partyColor, "--ps-bloom-color": partyColor } as React.CSSProperties}
          >
            {ps.toFixed(0)}
            <span className="text-xs text-muted ml-1">/ {effectiveCap}</span>
          </div>
        </div>
      </div>

      <div className={`space-y-3 ${compact ? "px-4 py-3" : "px-6 py-4"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm min-w-0">
            <div className="flex items-center text-muted text-xs">
              Spend Political Strength
              <Tooltip
                label="About the pressure ladder"
                content={`Each Build Org click costs a base of ${BUILD_ORG_BASE_PS_COST} PS, plus escalation from how often you've built in this state recently (the pressure ladder).`}
              />
            </div>
            <div className="text-[11px] text-muted/80 leading-snug">
              Base {BUILD_ORG_BASE_PS_COST} PS · pressure ladder may raise the next cost
            </div>
          </div>
          {buttons}
        </div>
        {estimate}
        <PoachLines
          poaches={lastResult?.poaches ?? (preview && preview.ok ? (preview.poaches ?? []) : [])}
        />
      </div>
    </div>
  );
}

/**
 * Per-rival poach breakdown for the unified Build Org action — lists how much
 * Org each rival loses to the click (preview projection or last-click actuals).
 * Renders nothing when there are no rivals being poached (open-pool build).
 */
function PoachLines({ poaches }: { poaches: PoachLine[] }) {
  if (!poaches.length) return null;
  const sorted = [...poaches].sort((a, b) => b.loss - a.loss);
  return (
    <div className="rounded-lg border border-card-border/40 bg-background/30 px-4 py-3">
      <div className="flex items-center text-[10px] font-semibold uppercase tracking-wide text-muted">
        Taken from rivals
        <Tooltip
          label="About rival poaching"
          content="When the unaffiliated pool is thin, Build Org also transfers Org from rivals. Larger rival Org and weaker rival PS both increase how much is taken."
        />
      </div>
      <ul className="mt-2 space-y-1.5">
        {sorted.map((p) => {
          const label = p.abbreviation?.trim() || p.partyName?.trim() || `Party #${p.partyId}`;
          const secondary =
            p.abbreviation && p.partyName && p.abbreviation !== p.partyName ? p.partyName : null;
          return (
            <li key={p.partyId} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-foreground">
                {label}
                {secondary ? (
                  <span className="ml-1.5 text-[10px] text-muted">{secondary}</span>
                ) : null}
              </span>
              <span className="shrink-0 font-medium tabular-nums text-error">
                −{p.loss.toFixed(2)} Org
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
