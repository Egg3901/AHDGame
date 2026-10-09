"use client";

import { useState } from "react";
import { regionPartyApiUrl } from "@/lib/urls";
import { useToast } from "@/contexts/ToastContext";
import { Tooltip } from "@/components/ui";
import {
  BUILD_ORG_BASE_PS_COST,
  STATE_PS_CAP_DEFAULT,
} from "@/lib/politicalStrength/strengthConstants";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { orgBuildCashPrice } from "@/lib/politicalStrength/buildOrgFunding";
import type { CountryId } from "@/lib/constants/countries";
import { EstimateBox } from "./EstimateBox";
import { PsSpendButtons } from "./PsSpendButtons";
import { usePsSpendScope } from "./usePsSpendScope";
import { useActionPreview } from "./useActionPreview";
import { apiErrorText } from "@/lib/errors/catalog";

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

interface DilutionLine {
  partyId: string;
  loss: number;
  /** Present on the post-click result; absent on preview. */
  newOrg?: number;
  partyName?: string;
  abbreviation?: string;
}

interface BuildOrgResult {
  psCost: number;
  /** Cash actually debited from the paying treasury. */
  cashCost?: number;
  /** Share of the full price the treasury covered. */
  fundedFraction?: number;
  contributionUnits: number;
  organizationUnits: number;
  orgGain: number;
  dilutions?: DilutionLine[];
}

type BuildOrgPreview =
  | {
      ok: true;
      effectiveCost: number;
      pressureValue: number;
      /** Cash price of the next click, in the paying tier's local currency. */
      cashPrice?: number;
      /** Balance of the treasury that would pay. */
      treasuryAvailable?: number;
      /** Share of the price the treasury covers. */
      fundedFraction?: number;
      /** Per-state size multiplier already folded into `cashPrice`. */
      sizeMultiplier?: number;
      projectedGain: number;
      contributionUnits: number;
      projectedOrganizationUnits: number;
      dilutions?: DilutionLine[];
      scope: "state" | "national-targeted";
    }
  | { ok: false; reason: string; message: string };

/**
 * Surface-agnostic Build Org panel. Spends Political Strength to grow the
 * party's regional contribution balance by one fixed unit. Org% is the party's
 * derived share of the accumulated bucket. Renders on the region party
 * Overview (full) and the State Politics tab (compact).
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
  // Build Org bills the paying tier's treasury, which is denominated in the
  // country's own currency — never the anchor.
  const currencyCode =
    COUNTRY_CURRENCY_MAP[countryCode.toUpperCase() as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
  const { eligibleScopes, poolPS } = usePsSpendScope(
    countryCode,
    stateId,
    partyId,
    canBuildOrg,
    bumpKey
  );
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
        showToast(apiErrorText(d, "Build Organization failed"), "error");
        return;
      }
      setLastResult(d as BuildOrgResult);
      setBumpKey((k) => k + 1);
      const cashCost = d.cashCost as number | undefined;
      const cash =
        cashCost !== undefined
          ? ` and ${CURRENCY_SYMBOLS[currencyCode as keyof typeof CURRENCY_SYMBOLS] ?? "$"}${Math.round(cashCost).toLocaleString("en-US")}`
          : "";
      const partly =
        typeof d.fundedFraction === "number" && d.fundedFraction < 1
          ? ` (partly funded: the treasury covered ${Math.round((d.fundedFraction as number) * 100)}% of the price)`
          : "";
      showToast(
        `+${(d.contributionUnits as number).toFixed(0)} Org unit, share ${(d.orgGain as number) >= 0 ? "+" : ""}${(d.orgGain as number).toFixed(2)}% for ${(d.psCost as number).toFixed(0)} PS${cash}${partly}`,
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
  // Gate on the NEXT click's cost (base + pressure ladder) from the preview,
  // not the base cost: after repeated spends the ladder can price the next
  // click above the remaining reserve while the base check still passes.
  // Before the preview resolves, fall back to the base cost so the buttons
  // do not all disable on a slow network.
  const nextPsCost = preview?.ok === true ? preview.effectiveCost : BUILD_ORG_BASE_PS_COST;
  const insufficientPs = !paysFromNationalPool && ps < nextPsCost;
  const noPresence = !hasPresence;

  const statePoolPs = poolPS?.statePoolPS ?? ps;
  const nationalPoolPs = poolPS?.nationalPoolPS ?? 0;
  const statePoolInsufficient = statePoolPs < nextPsCost;
  const nationalPoolInsufficient = nationalPoolPs < nextPsCost;

  // Header reserve must match the pool the preview will debit — national chairs
  // were shown state PS (often near cap) while Strength Capacity drained (ticket #1059).
  const headerPs = paysFromNationalPool
    ? (poolPS?.nationalPoolPS ?? 0)
    : (poolPS?.statePoolPS ?? ps);
  // The national cap is not loaded here, so the national reserve shows no "/ cap".
  const headerCapLabel = paysFromNationalPool ? null : String(effectiveCap);
  const headerPoolLabel = paysFromNationalPool ? "National party PS" : "State party PS";
  const headerPoolTooltip = paysFromNationalPool
    ? "The national party's Political Strength (PS). Building organization from a national officer role spends this reserve, not the state party's."
    : "This state party's Political Strength (PS), out of its maximum. Building organization spends it (or the national party's PS if you hold a national role).";

  /**
   * Per-pool cash price for the button tooltips.
   *
   * The estimate box can only show one tier's price — the one the preview
   * resolved, which for an officer holding BOTH a national and a state seat is
   * the state (half-rate) one. The national button would then charge twice what
   * was quoted. The PS cost is tier-independent (the pressure ladder is per
   * party+state), so both prices derive exactly from the same preview with no
   * extra request — including the per-state size multiplier, which applies to
   * either pool because it prices the state being organized, not the payer.
   */
  const priceFor = (poolScope: "state" | "national-targeted") => {
    const effectiveCost = preview?.ok ? preview.effectiveCost : null;
    if (effectiveCost === null) return "";
    const amount = orgBuildCashPrice(
      countryCode.toUpperCase() as CountryId,
      poolScope,
      effectiveCost,
      preview?.ok ? (preview.sizeMultiplier ?? 1) : 1
    );
    if (amount <= 0) return "";
    const symbol = CURRENCY_SYMBOLS[currencyCode as keyof typeof CURRENCY_SYMBOLS] ?? "$";
    return ` and ${symbol}${amount.toLocaleString("en-US")}`;
  };

  const buttonAnim = bumpKey > 0 ? "ps-bloom" : "";
  const counterAnim = bumpKey > 0 ? "ps-counter-pulse" : "";
  const tileAnim = bumpKey > 0 ? "ps-row-flash" : "";

  const buttons = (
    <PsSpendButtons
      scopes={eligibleScopes}
      color={partyColor}
      busy={busy}
      label="Build organization"
      busyLabel="Building…"
      singleDisabled={!canBuildOrg || insufficientPs || noPresence}
      stateDisabled={!canBuildOrg || statePoolInsufficient || noPresence}
      nationalDisabled={!canBuildOrg || nationalPoolInsufficient || noPresence}
      singleTitle={
        !canBuildOrg
          ? "Only the party chair, vice chair, or admin can build organization"
          : noPresence
            ? "Establish a player or elected official in this state first"
            : insufficientPs
              ? `Need ${nextPsCost.toFixed(0)} PS for the next build, have ${ps.toFixed(0)}`
              : "Spend Political Strength to grow the party's Organization in this state"
      }
      stateTitle={
        !canBuildOrg
          ? "Only the party chair, vice chair, or admin can build organization"
          : noPresence
            ? "Establish a player or elected official in this state first"
            : statePoolInsufficient
              ? `Need ${nextPsCost.toFixed(0)} PS for the next build, the state party has ${statePoolPs.toFixed(0)}`
              : `Spend the state party's PS${poolPS ? ` (has ${poolPS.statePoolPS.toFixed(0)})` : ""}${priceFor("state")}`
      }
      nationalTitle={
        !canBuildOrg
          ? "Only the party chair, vice chair, or admin can build organization"
          : noPresence
            ? "Establish a player or elected official in this state first"
            : nationalPoolInsufficient
              ? `Need ${nextPsCost.toFixed(0)} PS for the next build, the national party has ${nationalPoolPs.toFixed(0)}`
              : `Spend the national party's PS${poolPS ? ` (has ${poolPS.nationalPoolPS.toFixed(0)})` : ""}${priceFor("national-targeted")}`
      }
      buttonAnim={buttonAnim}
      onSpend={handleClick}
    />
  );

  const estimate = lastResult ? (
    <EstimateBox
      variant="last"
      tone="build"
      cost={{ effectivePS: lastResult.psCost, basePS: lastResult.psCost, ladderPS: 0 }}
      funds={
        lastResult.cashCost !== undefined
          ? {
              amount: lastResult.cashCost,
              currencyCode,
              fundedFraction: lastResult.fundedFraction,
            }
          : undefined
      }
      gain={{ label: "Share change", value: lastResult.orgGain, sign: "+", unit: "%" }}
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
      funds={
        preview.cashPrice !== undefined
          ? {
              amount: preview.cashPrice,
              currencyCode,
              fundedFraction: preview.fundedFraction,
              sizeMultiplier: preview.sizeMultiplier,
            }
          : undefined
      }
      gain={{ label: "Estimated share", value: preview.projectedGain, sign: "+", unit: "%" }}
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
        <div className="text-[11px] italic text-muted">
          Each successful click adds one unit to this party&apos;s Organization in this state.
        </div>
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
            <h2 className={compact ? "text-sm font-semibold" : "font-semibold"}>
              Build organization
            </h2>
            <Tooltip
              label="About building organization"
              content="Spend Political Strength (PS) to add one unit to this party's Organization (Org) in this state. Org % is the party's share of all the organization every party has built here, and it scales the party's votes in general elections."
            />
          </div>
          {compact ? null : (
            <p className="text-xs text-muted/70 leading-relaxed max-w-lg">
              Build lasting organization in this state one unit at a time. Every click adds the same
              amount, but the PS cost rises if you build here several times in a row.
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center justify-end text-body-sm font-medium text-muted">
            {headerPoolLabel}
            <Tooltip label="About political strength" content={headerPoolTooltip} />
          </div>
          <div
            key={`ps-${bumpKey}`}
            className={`font-bold tabular-nums ${compact ? "text-lg" : "text-2xl"} ${counterAnim}`}
            style={{ color: partyColor, "--ps-bloom-color": partyColor } as React.CSSProperties}
          >
            {headerPs.toFixed(0)}
            {headerCapLabel ? (
              <span className="text-xs text-muted ml-1">/ {headerCapLabel}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className={`space-y-3 ${compact ? "px-4 py-3" : "px-6 py-4"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm min-w-0">
            <div className="flex items-center text-muted text-xs">
              Spend political strength
              <Tooltip
                label="About the pressure ladder"
                content={`Each Build Org click costs a base of ${BUILD_ORG_BASE_PS_COST} PS, plus escalation from how often you've built in this state recently (the pressure ladder).`}
              />
            </div>
            <div className="text-[11px] text-muted/80 leading-snug">
              Costs {BUILD_ORG_BASE_PS_COST} PS, more if you have built here recently
            </div>
          </div>
          {buttons}
        </div>
        {estimate}
        <DilutionLines
          dilutions={
            lastResult?.dilutions ?? (preview && preview.ok ? (preview.dilutions ?? []) : [])
          }
        />
      </div>
    </div>
  );
}

/**
 * Per-rival dilution breakdown for one fixed bucket contribution.
 */
function DilutionLines({ dilutions }: { dilutions: DilutionLine[] }) {
  if (!dilutions.length) return null;
  const sorted = [...dilutions].sort((a, b) => b.loss - a.loss);
  return (
    <div className="rounded-lg border border-card-border/40 bg-background/30 px-4 py-3">
      <div className="flex items-center text-body-sm font-medium text-muted">
        Share dilution
        <Tooltip
          label="About share dilution"
          content="Adding a unit does not remove a rival's accumulated units. The new unit slightly reduces every other party's percentage share while the permanent Unaffiliated stake remains in the bucket."
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
