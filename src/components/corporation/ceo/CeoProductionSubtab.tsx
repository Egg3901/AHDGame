"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Slider } from "@/components/ui";
import { InfoTooltip } from "@/components/InfoTooltip";
import { STATE_FLAGS } from "@/lib/constants";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import {
  CORPORATION_TYPE_LABELS,
  MIN_GROWTH_RATE,
  MAX_GROWTH_RATE,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import { getPolicyEffectInfo } from "@/lib/utils/productionPolicy";
import Link from "next/link";
import { getTypeColor } from "../CorporationHelpers";
import {
  BuildQueueBadge,
  CAPACITY_UNIT_LABEL,
  FillChip,
  MothballedPill,
  formatUnits,
  sectorBuildUrl,
} from "../plantsPresentation";
import type { CorporationDetail, SectorDetail } from "../CorporationPageTypes";

type PolicyMode = "sector" | "type" | "corporate";

/** Result shape returned by the atomic bulk endpoint helper. */
export interface BulkOperationsResult {
  ok: boolean;
  matchedCount?: number;
  growth?: {
    targetGrowthRate: number;
    projectedTotalCostPerTurn: number;
    currentTotalCostPerTurn: number;
    costDeltaPerTurn: number;
  };
  error?: string;
}

export type BulkOperationsFn = (
  countryId: string,
  sectorType: CorporationType | null,
  body: {
    targetGrowthRate?: number;
    productionPolicy?: number; // pragma: allowlist secret
    pricingPosture?: number | null;
    preview?: boolean;
  }
) => Promise<BulkOperationsResult>;

/** Single-sector growth set, with optional preview (projected cost, no write). */
export type SectorGrowthFn = (
  sectorId: string,
  targetGrowthRate: number,
  body?: { preview?: boolean }
) => Promise<{
  ok: boolean;
  projectedCostPerTurn?: number;
  currentCostPerTurn?: number;
  costDeltaPerTurn?: number;
  error?: string;
}>;

interface PolicyMetricBlockProps {
  label: React.ReactNode;
  tooltip: React.ReactNode;
  children: React.ReactNode;
  valueClassName?: string;
}

function PolicyMetricBlock({
  label,
  tooltip,
  children,
  valueClassName = "",
}: PolicyMetricBlockProps) {
  return (
    <div className="min-w-0 rounded-lg border border-card-border/60 bg-card-muted/20 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted leading-tight mb-1.5">
        <InfoTooltip
          trigger={
            <span className="cursor-help border-b border-dotted border-muted/40">{label}</span>
          }
          width={240}
        >
          {tooltip}
        </InfoTooltip>
      </div>
      <div className={`text-sm tabular-nums font-medium break-words ${valueClassName}`.trim()}>
        {children}
      </div>
    </div>
  );
}

/**
 * Bulk growth + output policy + pricing-posture controls for one group.
 * sectorType set = one type; null = Corporate-Wide.
 * Output policy and pricing apply directly; growth previews cost then confirms.
 */

const POSTURE_STEPS = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2] as const;

function postureLabel(p: number): string {
  if (p === 0) return "Market";
  return `${p > 0 ? "+" : ""}${Math.round(p * 100)}%`;
}

function BulkGroupCard({
  country,
  sectorType,
  label,
  sectorCount,
  onBulkOperations,
  fmtMoney,
  plantsMode = false,
}: {
  country: string;
  sectorType: CorporationType | null;
  label: React.ReactNode;
  sectorCount: number;
  onBulkOperations: BulkOperationsFn;
  fmtMoney: (val: number) => string;
  /** Plants tier: the bulk growth lever is retired, so it is not offered. */
  plantsMode?: boolean;
}) {
  const [growthDraft, setGrowthDraft] = useState(0);
  const [productionDraft, setProductionDraft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<null | {
    target: number;
    matchedCount: number;
    projected: number;
    current: number;
    delta: number;
  }>(null);

  async function applyProduction() {
    setSaving(true);
    setMessage("");
    const r = await onBulkOperations(country, sectorType, { productionPolicy: productionDraft });
    setSaving(false);
    setMessage(r.ok ? `Set production for ${r.matchedCount ?? 0} holdings` : (r.error ?? "Failed"));
  }

  async function applyPricing(value: number | null) {
    setSaving(true);
    setMessage("");
    const r = await onBulkOperations(country, sectorType, { pricingPosture: value });
    setSaving(false);
    if (!r.ok) {
      setMessage(r.error ?? "Failed");
      return;
    }
    setMessage(
      value == null
        ? `Set pricing to Auto across ${r.matchedCount ?? 0} holdings`
        : `Set pricing to ${postureLabel(value)} across ${r.matchedCount ?? 0} holdings`
    );
  }

  async function startGrowthPreview() {
    setSaving(true);
    setMessage("");
    const r = await onBulkOperations(country, sectorType, {
      targetGrowthRate: growthDraft,
      preview: true,
    });
    setSaving(false);
    if (r.ok && r.growth) {
      setPreview({
        target: growthDraft,
        matchedCount: r.matchedCount ?? 0,
        projected: r.growth.projectedTotalCostPerTurn,
        current: r.growth.currentTotalCostPerTurn,
        delta: r.growth.costDeltaPerTurn,
      });
    } else {
      setMessage(r.error ?? "Failed to preview");
    }
  }

  async function confirmGrowth() {
    if (!preview) return;
    setSaving(true);
    const r = await onBulkOperations(country, sectorType, { targetGrowthRate: preview.target });
    setSaving(false);
    setPreview(null);
    setMessage(r.ok ? `Set growth for ${r.matchedCount ?? 0} holdings` : (r.error ?? "Failed"));
  }

  return (
    <div className="rounded-xl border border-card-border bg-card-elevated/25 p-4">
      <div className="flex items-center gap-3 mb-3">
        {label}
        <span className="text-sm text-muted">
          {sectorCount} sector{sectorCount === 1 ? "" : "s"}
        </span>
      </div>

      {/* Growth target (preview + confirm).
          Hidden under plants: capacity comes from build orders placed against a
          specific sector, and a bulk "set growth to 4%" there writes a target
          that no longer builds anything. Leaving the control visible would let
          a CEO spend a turn tuning a slider with no effect — worse than not
          offering it. Production policy and pricing below still apply. */}
      <div className={plantsMode ? "hidden" : "mb-4"}>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
          Growth target
        </div>
        <div className="flex items-center gap-3">
          <Slider
            min={MIN_GROWTH_RATE}
            max={MAX_GROWTH_RATE}
            step={0.5}
            value={growthDraft}
            onChange={(e) => setGrowthDraft(Number(e.target.value))}
            variant="success"
            className="flex-1"
          />
          <input
            type="number"
            min={MIN_GROWTH_RATE}
            max={MAX_GROWTH_RATE}
            step={0.5}
            value={growthDraft}
            onChange={(e) =>
              setGrowthDraft(
                Math.max(MIN_GROWTH_RATE, Math.min(MAX_GROWTH_RATE, Number(e.target.value)))
              )
            }
            aria-label="Bulk growth target"
            className="w-20 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
          />
          <span className="text-sm text-muted">%</span>
          <button
            onClick={startGrowthPreview}
            disabled={saving || preview !== null}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving && !preview ? "…" : "Set growth"}
          </button>
        </div>
        {preview && (
          <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
            <p className="text-foreground">
              Set growth to {preview.target}% across {preview.matchedCount} holdings. Projected cost
              ~{fmtMoney(Math.round(preview.projected / 24))}/turn (currently ~{fmtMoney(Math.round(preview.current / 24))}/turn,{" "}
              {preview.delta >= 0 ? "+" : ""}
              {fmtMoney(preview.delta)}). Projected once ramped.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={confirmGrowth}
                disabled={saving}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Applying…" : "Confirm"}
              </button>
              <button
                onClick={() => setPreview(null)}
                className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Production policy (direct apply) */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
          Production policy
        </div>
        <div className="flex items-center gap-3">
          <Slider
            min={-25}
            max={25}
            step={1}
            value={productionDraft}
            onChange={(e) => setProductionDraft(Number(e.target.value))}
            variant={productionDraft >= 0 ? "success" : "error"}
            className="flex-1"
          />
          <input
            type="number"
            min={-25}
            max={25}
            step={1}
            value={productionDraft}
            onChange={(e) =>
              setProductionDraft(Math.max(-25, Math.min(25, Number(e.target.value))))
            }
            aria-label="Bulk production policy"
            className="w-20 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
          />
          <span className="text-sm text-muted">%</span>
          <button
            onClick={applyProduction}
            disabled={saving}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? "…" : "Set production"}
          </button>
        </div>
      </div>

      {/* Pricing posture (direct apply; requires market clearing) */}
      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
          Pricing posture
        </div>
        <p className="text-[11px] text-muted mb-2">
          Posted price vs market for every holding in this group. Undercut to sell first; skim for
          margin.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {POSTURE_STEPS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={saving}
              onClick={() => void applyPricing(p)}
              className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium tabular-nums transition-colors hover:bg-card disabled:opacity-50"
            >
              {postureLabel(p)}
            </button>
          ))}
          <button
            type="button"
            disabled={saving}
            onClick={() => void applyPricing(null)}
            className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-card disabled:opacity-50"
          >
            Auto
          </button>
        </div>
      </div>

      {message && (
        <p className={`mt-2 text-xs ${message.startsWith("Set") ? "text-success" : "text-error"}`}>
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * Per-sector growth control (preview + confirm) for the By Sector card. Mirrors
 * the bulk growth flow but scoped to a single holding via the single-sector
 * growth endpoint's preview flag.
 */
function SectorGrowthControl({
  sectorId,
  currentTarget,
  onSectorGrowth,
  fmtMoney,
}: {
  sectorId: string;
  currentTarget: number;
  onSectorGrowth: SectorGrowthFn;
  fmtMoney: (val: number) => string;
}) {
  const [draft, setDraft] = useState(currentTarget);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<null | {
    target: number;
    projected: number;
    current: number;
    delta: number;
  }>(null);

  async function startPreview() {
    setSaving(true);
    setMessage("");
    const r = await onSectorGrowth(sectorId, draft, { preview: true });
    setSaving(false);
    if (r.ok) {
      setPreview({
        target: draft,
        projected: r.projectedCostPerTurn ?? 0,
        current: r.currentCostPerTurn ?? 0,
        delta: r.costDeltaPerTurn ?? 0,
      });
    } else {
      setMessage(r.error ?? "Failed to preview");
    }
  }

  async function confirm() {
    if (!preview) return;
    setSaving(true);
    const r = await onSectorGrowth(sectorId, preview.target);
    setSaving(false);
    setPreview(null);
    setMessage(r.ok ? "Growth target set" : (r.error ?? "Failed"));
  }

  return (
    <div className="mt-3 border-t border-card-border/40 pt-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
        Growth target
      </div>
      <div className="flex items-center gap-3">
        <Slider
          min={MIN_GROWTH_RATE}
          max={MAX_GROWTH_RATE}
          step={0.5}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          variant="success"
          className="flex-1"
        />
        <input
          type="number"
          min={MIN_GROWTH_RATE}
          max={MAX_GROWTH_RATE}
          step={0.5}
          value={draft}
          onChange={(e) =>
            setDraft(Math.max(MIN_GROWTH_RATE, Math.min(MAX_GROWTH_RATE, Number(e.target.value))))
          }
          aria-label="Sector growth target"
          className="w-20 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
        />
        <span className="text-sm text-muted">%</span>
        <button
          onClick={startPreview}
          disabled={saving || preview !== null}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving && !preview ? "…" : "Set growth"}
        </button>
      </div>
      {preview && (
        <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
          <p className="text-foreground">
            Set growth to {preview.target}%. Projected cost ~{fmtMoney(Math.round(preview.projected / 24))}/turn
            (currently ~{fmtMoney(Math.round(preview.current / 24))}/turn, {preview.delta >= 0 ? "+" : ""}
            {fmtMoney(preview.delta)}). Projected once ramped.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={confirm}
              disabled={saving}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Applying…" : "Confirm"}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className={`mt-2 text-xs ${message.includes("set") ? "text-success" : "text-error"}`}>
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * Per-sector build summary — the plants-tier replacement for the growth slider.
 *
 * The slider answered "how fast should this sector grow?", a question plants
 * mode does not have. The question it does have is "can these facilities sell what
 * they make, and should I build more?" — so the panel states capacity, fill and
 * anything already under construction, then offers the one action that changes
 * any of it.
 */
function SectorBuildSummary({
  sector,
  corpId,
  isCeo,
}: {
  sector: SectorDetail;
  corpId: string;
  isCeo: boolean;
}) {
  const queue = sector.buildQueueSummary ?? null;
  return (
    <div className="mt-3 border-t border-card-border/40 pt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Capacity</span>
        {sector.mothballed && <MothballedPill sectorType={sector.sectorType as CorporationType} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="text-sm font-medium tabular-nums text-foreground">
            {formatUnits(sector.capacityUnits)}
            <span className="ml-1 text-[10px] font-normal text-muted">{CAPACITY_UNIT_LABEL}</span>
          </div>
          <BuildQueueBadge queue={queue} className="mt-1" />
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Fill</div>
          <FillChip fill={sector.fillRate} band={sector.fillRateBand} />
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Sold / made</div>
          <div className="text-xs tabular-nums text-muted">
            {formatUnits(sector.soldUnits)} / {formatUnits(sector.producedUnits)}
          </div>
        </div>
        {isCeo && (
          <Link
            href={sectorBuildUrl(corpId, sector._id)}
            className="ml-auto rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            Build capacity
          </Link>
        )}
      </div>
      {queue == null && sector.fillRateBand === "low" && (
        <p className="mt-2 text-[11px] leading-snug text-warning">
          These plants are leaving output unsold. Building more capacity here will not raise revenue
          until you can sell what you already make.
        </p>
      )}
    </div>
  );
}

interface CeoProductionSubtabProps {
  corporation: CorporationDetail;
  sectors: SectorDetail[];
  /** Needed for the plants build deep links. */
  corpId: string;
  onSavePolicy: (sectorId: string, productionPolicy: number) => void;
  onBulkOperations: BulkOperationsFn;
  onSectorGrowth: SectorGrowthFn;
}

export default function CeoProductionSubtab({
  corporation,
  sectors,
  corpId,
  onSavePolicy,
  onBulkOperations,
  onSectorGrowth,
}: CeoProductionSubtabProps) {
  const plantsMode = corporation.plantsMode === true;
  const { formatAmount, toInternalFrom } = useCurrency();
  // Post-v0.2.6: sector revenue / growth cost / profit are in corp currency.
  const liquidCode = corporation.liquidCurrencyCode as
    import("@/lib/constants/currencies").CurrencyCode | undefined;
  const fmtMoney = (val: number) => {
    const anchor = liquidCode ? toInternalFrom(val, liquidCode) : val;
    return formatAmount(anchor, liquidCode);
  };
  const [policyMode, setPolicyMode] = useState<PolicyMode>("sector");
  const [policyDraft, setPolicyDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(sectors.map((s) => [s._id, s.productionPolicy ?? 0]))
  );
  const [policySaving, setPolicySaving] = useState<Record<string, boolean>>({});
  const [policyMessages, setPolicyMessages] = useState<Record<string, string>>({});

  // Whether the corporation operates in more than one country — drives whether
  // group labels disambiguate by country.
  const corpSpansCountries = useMemo(
    () => new Set(sectors.map((s) => s.countryId ?? corporation.countryId)).size > 1,
    [sectors, corporation.countryId]
  );

  // By Type groups, keyed by (country, sectorType) so each bulk action is single-
  // country (per-country scope). Collapses to per-type for single-country corps.
  const sectorGroups = useMemo(() => {
    const groups: Record<
      string,
      { country: string; sectorType: CorporationType; sectors: SectorDetail[] }
    > = {};
    for (const s of sectors) {
      const country = s.countryId ?? corporation.countryId;
      const key = `${country}::${s.sectorType}`;
      (groups[key] ??= {
        country,
        sectorType: s.sectorType as CorporationType,
        sectors: [],
      }).sectors.push(s);
    }
    return groups;
  }, [sectors, corporation.countryId]);

  // By Type cards grouped by country for the accordion layout.
  const typeGroupsByCountry = useMemo(() => {
    const byCountry: Record<
      string,
      { groupKey: string; sectorType: CorporationType; sectors: SectorDetail[] }[]
    > = {};
    for (const [groupKey, g] of Object.entries(sectorGroups)) {
      (byCountry[g.country] ??= []).push({
        groupKey,
        sectorType: g.sectorType,
        sectors: g.sectors,
      });
    }
    return byCountry;
  }, [sectorGroups]);

  // Default the home country open; if the corp holds nothing in its home country
  // (all-foreign holdings), fall back to the first country so something is open.
  const defaultOpenCountry = useMemo(() => {
    const keys = Object.keys(typeGroupsByCountry);
    return keys.includes(corporation.countryId) ? corporation.countryId : keys[0];
  }, [typeGroupsByCountry, corporation.countryId]);
  const [expandedCountries, setExpandedCountries] = useState<Record<string, boolean>>({});
  const isCountryExpanded = (country: string) =>
    expandedCountries[country] ?? country === defaultOpenCountry;
  const toggleCountry = (country: string) =>
    setExpandedCountries((prev) => ({ ...prev, [country]: !isCountryExpanded(country) }));

  // Corporate-Wide: one card per country the corp operates in.
  const sectorsByCountry = useMemo(() => {
    const groups: Record<string, SectorDetail[]> = {};
    for (const s of sectors) (groups[s.countryId ?? corporation.countryId] ??= []).push(s);
    return groups;
  }, [sectors, corporation.countryId]);

  const corporateAggregates = useMemo(() => {
    if (sectors.length === 0) return { revenue: 0, avgMargin: 0, avgActive: 0 };
    const revenue = sectors.reduce((sum, s) => sum + s.revenue, 0);
    const avgMargin =
      Math.round(
        (sectors.reduce((sum, s) => sum + s.effectiveProfitMargin, 0) / sectors.length) * 10
      ) / 10;
    const avgActive =
      Math.round(
        (sectors.reduce((sum, s) => sum + (s.productionPolicyLevel ?? 0), 0) / sectors.length) * 10
      ) / 10;
    return { revenue, avgMargin, avgActive };
  }, [sectors]);

  async function handleSavePolicy(sectorId: string, productionPolicy: number) {
    setPolicySaving((prev) => ({ ...prev, [sectorId]: true }));
    setPolicyMessages((prev) => ({ ...prev, [sectorId]: "" }));
    await onSavePolicy(sectorId, productionPolicy);
    setPolicySaving((prev) => ({ ...prev, [sectorId]: false }));
  }

  return (
    <>
      {/* Sector Operations */}
      {sectors.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground mb-1">Sector Operations</h2>
          <p className="text-sm text-muted mb-4">
            {plantsMode
              ? "Set the production output level across your facilities. Production runs from -25% to +25% and trends toward the target at 1 point per turn. Capacity is not a slider here: you buy it site by site, so each holding below shows what it can make, how much of that is selling, and a way to order more."
              : "Set a growth target and production output level across your holdings. Production runs from -25% to +25% and trends toward the target at 1 point per turn; growth raises revenue but carries a per-turn cost. Use By Type or Corporate-Wide to set many holdings at once."}
          </p>

          {/* Mode toggle */}
          <div className="flex rounded-lg border border-card-border bg-card-muted/30 p-0.5 mb-5">
            {[
              { key: "sector" as const, label: "By Sector" },
              { key: "type" as const, label: "By Type" },
              { key: "corporate" as const, label: "Corporate-Wide" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPolicyMode(key)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  policyMode === key
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── By Sector mode (per-holding production) ── */}
          {policyMode === "sector" && (
            <ul className="list-none space-y-4">
              {sectors.map((sector) => {
                const draft = policyDraft[sector._id] ?? 0;
                const active = sector.productionPolicyLevel ?? 0;
                const msg = policyMessages[sector._id];
                const isSaving = policySaving[sector._id] ?? false;
                return (
                  <li
                    key={sector._id}
                    className="rounded-xl border border-card-border bg-card-elevated/25 shadow-sm overflow-hidden"
                  >
                    {/* Header row — mirrors SectorsTab */}
                    <div className="flex flex-col gap-2 p-4 border-b border-card-border/50 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        {STATE_FLAGS[sector.stateId] && (
                          <Image
                            src={STATE_FLAGS[sector.stateId]}
                            alt={sector.stateId}
                            width={28}
                            height={18}
                            className="rounded-sm object-cover shrink-0"
                            unoptimized={bypassNextImageOptimization(STATE_FLAGS[sector.stateId])}
                          />
                        )}
                        <span className="font-semibold text-base text-foreground truncate">
                          {sector.stateName}
                        </span>
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getTypeColor(sector.sectorType as CorporationType)}`}
                        >
                          {CORPORATION_TYPE_LABELS[sector.sectorType as CorporationType]}
                        </span>
                      </div>
                      <span className="text-xs text-muted">
                        Active:{" "}
                        <span className={active >= 0 ? "text-success" : "text-error"}>
                          {active >= 0 ? "+" : ""}
                          {active}%
                        </span>
                      </span>
                    </div>

                    {/* Metrics grid */}
                    <div className="p-4 pt-3">
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 mb-3">
                        {plantsMode ? (
                          <>
                            <PolicyMetricBlock
                              label="Capacity"
                              tooltip={
                                <p className="text-muted">
                                  What these plants can make in one financial day, in output units.
                                </p>
                              }
                              valueClassName="text-foreground"
                            >
                              {formatUnits(sector.capacityUnits)}
                              <span className="text-xs font-normal text-muted">
                                {" "}
                                {CAPACITY_UNIT_LABEL}
                              </span>
                            </PolicyMetricBlock>
                            <PolicyMetricBlock
                              label="Fill"
                              tooltip={
                                <p className="text-muted">
                                  Share of what these plants produced that actually sold.
                                </p>
                              }
                            >
                              <FillChip fill={sector.fillRate} band={sector.fillRateBand} />
                            </PolicyMetricBlock>
                          </>
                        ) : (
                          <>
                            <PolicyMetricBlock
                              label="Growth"
                              tooltip={<p className="text-muted">Revenue growth rate per turn.</p>}
                              valueClassName="text-primary"
                            >
                              {sector.currentGrowthRate}%
                            </PolicyMetricBlock>
                            <PolicyMetricBlock
                              label="Growth cost"
                              tooltip={
                                <p className="text-muted">Per-turn cost of maintaining growth.</p>
                              }
                              valueClassName="text-error"
                            >
                              {fmtMoney(Math.round(sector.currentGrowthCost / 24))}
                              <span className="text-xs font-normal text-muted"> /turn</span>
                            </PolicyMetricBlock>
                          </>
                        )}
                        <PolicyMetricBlock
                          label="Revenue"
                          tooltip={<p className="text-muted">Per-turn gross revenue.</p>}
                          valueClassName="text-success"
                        >
                          {fmtMoney(Math.round(sector.revenue / 24))}
                          <span className="text-xs font-normal text-muted"> /turn</span>
                        </PolicyMetricBlock>
                        <PolicyMetricBlock
                          label="Margin"
                          tooltip={<p className="text-muted">Effective profit margin.</p>}
                          valueClassName="font-bold text-foreground"
                        >
                          {sector.effectiveProfitMargin}%
                        </PolicyMetricBlock>
                        <PolicyMetricBlock
                          label="Profit"
                          tooltip={<p className="text-muted">Per-turn profit after costs.</p>}
                          valueClassName={sector.profit >= 0 ? "text-success" : "text-error"}
                        >
                          {fmtMoney(Math.round(sector.profit / 24))}
                          <span className="text-xs font-normal text-muted"> /turn</span>
                        </PolicyMetricBlock>
                        <PolicyMetricBlock
                          label="Workers"
                          tooltip={<p className="text-muted">Employees in this sector.</p>}
                        >
                          {sector.workers.toLocaleString("en-US")}
                        </PolicyMetricBlock>
                      </div>

                      {/* Policy effect breakdown */}
                      {(() => {
                        const effects = getPolicyEffectInfo(active);
                        return (
                          <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg border border-card-border bg-background/50 p-2">
                            <div className="text-center">
                              <div className="text-[10px] text-muted">Revenue</div>
                              <div
                                className={`text-xs font-semibold ${effects.revenue.multiplier >= 1 ? "text-success" : "text-error"}`}
                              >
                                {effects.revenue.label}
                              </div>
                            </div>
                            <div className="text-center">
                              <div className="text-[10px] text-muted">Output (Supply)</div>
                              <div
                                className={`text-xs font-semibold ${effects.output.multiplier >= 1 ? "text-success" : "text-error"}`}
                              >
                                {effects.output.label}
                              </div>
                            </div>
                            <div className="text-center">
                              <div className="text-[10px] text-muted">Input (Demand)</div>
                              <div
                                className={`text-xs font-semibold ${effects.input.multiplier >= 1 ? "text-warning" : "text-success"}`}
                              >
                                {effects.input.label}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Slider row */}
                      <div className="flex items-center gap-3">
                        <Slider
                          min={-25}
                          max={25}
                          step={1}
                          value={draft}
                          onChange={(e) =>
                            setPolicyDraft((prev) => ({
                              ...prev,
                              [sector._id]: Number(e.target.value),
                            }))
                          }
                          variant={draft >= 0 ? "success" : "error"}
                          className="flex-1"
                        />
                        <input
                          type="number"
                          min={-25}
                          max={25}
                          step={1}
                          value={draft}
                          onChange={(e) =>
                            setPolicyDraft((prev) => ({
                              ...prev,
                              [sector._id]: Math.max(-25, Math.min(25, Number(e.target.value))),
                            }))
                          }
                          className="w-20 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
                        />
                        <span className="text-sm text-muted">%</span>
                        <button
                          onClick={() => handleSavePolicy(sector._id, draft)}
                          disabled={isSaving}
                          className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {isSaving ? "Saving..." : "Set"}
                        </button>
                      </div>
                      {msg && (
                        <p
                          className={`mt-2 text-xs ${msg.includes("Saved") ? "text-success" : "text-error"}`}
                        >
                          {msg}
                        </p>
                      )}

                      {plantsMode ? (
                        <SectorBuildSummary sector={sector} corpId={corpId} isCeo />
                      ) : (
                        <SectorGrowthControl
                          sectorId={sector._id}
                          currentTarget={sector.targetGrowthRate ?? 0}
                          onSectorGrowth={onSectorGrowth}
                          fmtMoney={fmtMoney}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* ── By Type mode (per-country accordions of bulk type cards) ── */}
          {policyMode === "type" && (
            <div className="space-y-3">
              {Object.entries(typeGroupsByCountry).map(([country, groups]) => {
                const open = isCountryExpanded(country);
                const sectorCount = groups.reduce((n, g) => n + g.sectors.length, 0);
                return (
                  <div
                    key={country}
                    className="rounded-xl border border-card-border overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCountry(country)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-3 bg-card-muted/30 px-4 py-3 text-left hover:bg-card-elevated/50 transition-colors"
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        {country}
                        <span className="text-xs font-normal text-muted">
                          {sectorCount} sector{sectorCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      <svg
                        className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                    {open && (
                      <div className="space-y-4 p-4">
                        {groups.map(({ groupKey, sectorType, sectors: g }) => (
                          <BulkGroupCard
                            key={groupKey}
                            country={country}
                            sectorType={sectorType}
                            sectorCount={g.length}
                            onBulkOperations={onBulkOperations}
                            fmtMoney={fmtMoney}
                            plantsMode={plantsMode}
                            label={
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getTypeColor(sectorType)}`}
                              >
                                {CORPORATION_TYPE_LABELS[sectorType]}
                              </span>
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Corporate-Wide mode (bulk growth + production, all types, per country) ── */}
          {policyMode === "corporate" && (
            <div className="space-y-4">
              {Object.entries(sectorsByCountry).map(([country, g]) => (
                <BulkGroupCard
                  key={`corporate-${country}`}
                  country={country}
                  sectorType={null}
                  sectorCount={g.length}
                  onBulkOperations={onBulkOperations}
                  fmtMoney={fmtMoney}
                  plantsMode={plantsMode}
                  label={
                    <span className="text-sm font-semibold text-foreground">
                      Corporate-Wide{corpSpansCountries ? ` · ${country}` : ""}
                    </span>
                  }
                />
              ))}
              <p className="text-xs text-muted">
                {sectors.length} sectors • Avg margin: {corporateAggregates.avgMargin}% • Avg
                active: {corporateAggregates.avgActive}% • {fmtMoney(corporateAggregates.revenue)}{" "}
                total daily revenue
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
