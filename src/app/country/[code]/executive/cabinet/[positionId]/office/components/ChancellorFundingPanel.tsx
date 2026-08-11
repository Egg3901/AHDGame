"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Slider } from "@/components/ui";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";

interface RegionRow {
  regionId: string;
  regionName: string;
  population: number;
}

interface RegionalBudget {
  regionId: string;
  fundingPoolAmount: number;
  westminsterGrant: number;
  nationalGrant: number;
  federalEqualizationGrant: number;
  totalBudget: number;
  propertyValuePerCapita: number;
  commercialValuePerCapita: number;
  chancellorAllocationPercent: number | null;
}

interface ChancellorFundingPanelProps {
  regionData: RegionRow[];
  regionalBudgets: RegionalBudget[];
  currentAllocations: Record<string, number> | null;
  canAct: boolean;
  positionId: string;
  countryCode: string;
  onUpdate: () => void;
}

function buildDefaultAllocations(regions: RegionRow[]): Record<string, number> {
  if (regions.length === 0) return {};
  const even = Math.floor(100 / regions.length);
  const remainder = 100 - even * regions.length;
  return Object.fromEntries(
    regions.map((region, index) => [region.regionId, even + (index === 0 ? remainder : 0)])
  );
}

function buildEqualAmounts(regions: RegionRow[], totalPool: number): Record<string, number> {
  if (regions.length === 0 || totalPool <= 0) return {};
  const even = totalPool / regions.length;
  return Object.fromEntries(regions.map((region) => [region.regionId, even]));
}

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatMoney(symbol: string, value: number): string {
  return `${symbol}${Math.round(value).toLocaleString("en-US")}`;
}

export function ChancellorFundingPanel({
  regionData,
  regionalBudgets,
  currentAllocations,
  canAct,
  positionId,
  countryCode,
  onUpdate,
}: ChancellorFundingPanelProps) {
  const countryId = countryCode.toUpperCase() as CountryId;
  const countryConfig = getCountryConfig(countryId);
  const symbol = CURRENCY_SYMBOLS[COUNTRY_CURRENCY_MAP[countryId]] ?? "$";
  const panelTitle =
    countryConfig.executiveTitle === "President"
      ? "State Grants Allocation"
      : "Regional Funding Allocation";
  const totalPool = useMemo(
    () => regionalBudgets.reduce((sum, budget) => sum + (budget.fundingPoolAmount ?? 0), 0),
    [regionalBudgets]
  );
  const amountMode = totalPool > 0;

  const sortedRegions = useMemo(
    () => [...regionData].sort((a, b) => a.regionName.localeCompare(b.regionName)),
    [regionData]
  );

  const baselinePercentages = useMemo(
    () => currentAllocations ?? buildDefaultAllocations(sortedRegions),
    [currentAllocations, sortedRegions]
  );

  const initialDraftValues = useMemo(() => {
    if (!amountMode) return baselinePercentages;
    return Object.fromEntries(
      sortedRegions.map((region) => [
        region.regionId,
        roundAmount(((baselinePercentages[region.regionId] ?? 0) / 100) * totalPool),
      ])
    );
  }, [amountMode, baselinePercentages, sortedRegions, totalPool]);

  const [draftValues, setDraftValues] = useState<Record<string, number>>(initialDraftValues);
  const [focusedRegionId, setFocusedRegionId] = useState("all");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    setDraftValues(initialDraftValues);
  }, [initialDraftValues]);

  const visibleRegions = useMemo(() => {
    if (focusedRegionId === "all") return sortedRegions;
    return sortedRegions.filter((region) => region.regionId === focusedRegionId);
  }, [focusedRegionId, sortedRegions]);

  const totalDraft = useMemo(
    () => Object.values(draftValues).reduce((sum, value) => sum + value, 0),
    [draftValues]
  );

  const derivedPercentages = useMemo(() => {
    if (!amountMode) return draftValues;
    return Object.fromEntries(
      sortedRegions.map((region) => [
        region.regionId,
        totalPool > 0 ? ((draftValues[region.regionId] ?? 0) / totalPool) * 100 : 0,
      ])
    );
  }, [amountMode, draftValues, sortedRegions, totalPool]);

  const remaining = amountMode ? totalPool - totalDraft : 100 - totalDraft;
  const isValid = Math.abs(remaining) < 0.01;

  const handleValueChange = useCallback((regionId: string, rawValue: string) => {
    const parsed = Number(rawValue);
    setDraftValues((prev) => ({
      ...prev,
      [regionId]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
    }));
  }, []);

  const handleEvenSplit = useCallback(() => {
    setFeedback(null);
    if (amountMode) {
      setDraftValues(buildEqualAmounts(sortedRegions, totalPool));
      return;
    }
    setDraftValues(buildDefaultAllocations(sortedRegions));
  }, [amountMode, sortedRegions, totalPool]);

  const handleNormalizeToPool = useCallback(() => {
    if (!amountMode || totalDraft <= 0 || totalPool <= 0) return;
    const scale = totalPool / totalDraft;
    setFeedback(null);
    setDraftValues(
      Object.fromEntries(
        sortedRegions.map((region) => [
          region.regionId,
          roundAmount((draftValues[region.regionId] ?? 0) * scale),
        ])
      )
    );
  }, [amountMode, draftValues, sortedRegions, totalDraft, totalPool]);

  async function handleSave() {
    if (!isValid || !canAct) return;
    setSaving(true);
    setFeedback(null);
    try {
      const allocations = Object.fromEntries(
        sortedRegions.map((region) => [region.regionId, derivedPercentages[region.regionId] ?? 0])
      );

      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/allocation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allocations }),
        }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setFeedback({ type: "error", message: json.error ?? "Failed to save" });
        return;
      }
      setFeedback({ type: "success", message: "Allocations saved." });
      onUpdate();
    } catch {
      setFeedback({ type: "error", message: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  const summaryLabel = amountMode ? "Remaining" : "Remaining Share";
  const summaryValue = amountMode
    ? formatMoney(symbol, Math.abs(remaining))
    : `${Math.abs(remaining).toFixed(1)}%`;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{panelTitle}</h2>
          <p className="mt-0.5 text-sm text-muted">
            Allocate the {countryConfig.centralGovernmentLabel.toLowerCase()} pool across all{" "}
            {countryConfig.regionLabelPlural.toLowerCase()}.
          </p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto lg:min-w-[440px]">
          <div className="rounded-lg border border-card-border bg-card-elevated px-3 py-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted">
              Available Pool
            </div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">
              {formatMoney(symbol, totalPool)}
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-card-elevated px-3 py-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted">
              {amountMode ? "Allocated" : "Assigned Share"}
            </div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">
              {amountMode ? formatMoney(symbol, totalDraft) : `${totalDraft.toFixed(1)}%`}
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-card-elevated px-3 py-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted">
              {summaryLabel}
            </div>
            <div
              className={`mt-1 text-sm font-semibold tabular-nums ${
                remaining >= -0.01 ? "text-success" : "text-error"
              }`}
            >
              {remaining < -0.01 ? "-" : ""}
              {summaryValue}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-card-border bg-card-elevated p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full lg:max-w-xs">
          <label
            htmlFor="allocation-region-filter"
            className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-muted"
          >
            Region Filter
          </label>
          <select
            id="allocation-region-filter"
            value={focusedRegionId}
            onChange={(event) => setFocusedRegionId(event.target.value)}
            className="block h-11 w-full rounded-lg border border-card-border bg-card px-4 text-sm text-foreground transition-all duration-150 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All {countryConfig.regionLabelPlural}</option>
            {sortedRegions.map((region) => (
              <option key={region.regionId} value={region.regionId}>
                {region.regionName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={handleEvenSplit} disabled={!canAct || saving}>
            Even Split
          </Button>
          {amountMode && (
            <Button
              variant="secondary"
              onClick={handleNormalizeToPool}
              disabled={!canAct || saving || totalDraft <= 0}
            >
              Normalize to Pool
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-card-border bg-card-elevated">
        <div
          className={`hidden gap-4 border-b border-card-border px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted md:grid ${
            amountMode
              ? "grid-cols-[minmax(0,1.3fr)_minmax(150px,180px)_110px]"
              : "grid-cols-[minmax(0,1.15fr)_minmax(250px,320px)_minmax(130px,160px)_110px]"
          }`}
        >
          <span>{countryConfig.regionLabel}</span>
          <span>{amountMode ? "Funding Amount" : "Share %"}</span>
          {!amountMode && <span>Money Value</span>}
          <span className="text-right">% of Pool</span>
        </div>

        <div className="max-h-[520px] overflow-y-auto">
          {visibleRegions.map((region) => {
            const draftValue = draftValues[region.regionId] ?? 0;
            const percent = derivedPercentages[region.regionId] ?? 0;
            const inputLabel = amountMode ? "Funding Amount" : "Share %";
            const projectedValue = amountMode
              ? draftValue
              : roundAmount((percent / 100) * totalPool);

            return (
              <div
                key={region.regionId}
                className={`grid grid-cols-1 gap-3 border-b border-card-border px-4 py-4 last:border-b-0 md:items-center md:gap-4 ${
                  amountMode
                    ? "md:grid-cols-[minmax(0,1.3fr)_minmax(150px,180px)_110px]"
                    : "md:grid-cols-[minmax(0,1.15fr)_minmax(250px,320px)_minmax(130px,160px)_110px]"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{region.regionName}</div>
                  <div className="mt-1 text-xs text-muted">
                    {amountMode
                      ? `Projected grant ${formatMoney(symbol, draftValue)}`
                      : `Current projected grant ${formatMoney(symbol, projectedValue)}`}
                  </div>
                </div>

                <div>
                  <div className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-muted md:hidden">
                    {inputLabel}
                  </div>
                  {amountMode ? (
                    <div className="relative">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted">
                        {symbol}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        value={Number.isFinite(draftValue) ? draftValue : 0}
                        disabled={!canAct}
                        onChange={(event) => handleValueChange(region.regionId, event.target.value)}
                        className="pl-8 pr-3 py-2"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-[minmax(0,1fr)_92px] items-center gap-3">
                      <Slider
                        min={0}
                        max={100}
                        step={0.1}
                        value={Number.isFinite(draftValue) ? draftValue : 0}
                        disabled={!canAct}
                        onChange={(event) => handleValueChange(region.regionId, event.target.value)}
                        variant={draftValue > 0 ? "primary" : "muted"}
                      />
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        value={Number.isFinite(draftValue) ? draftValue : 0}
                        disabled={!canAct}
                        onChange={(event) => handleValueChange(region.regionId, event.target.value)}
                        className="px-3 py-2"
                      />
                    </div>
                  )}
                </div>

                {!amountMode && (
                  <div className="flex items-center justify-between gap-2 md:block md:text-right">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-muted md:hidden">
                      Money Value
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-foreground">
                      {formatMoney(symbol, projectedValue)}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 md:block md:text-right">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-muted md:hidden">
                    % of Pool
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-foreground">
                    {percent.toFixed(1)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!amountMode && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          No current funding pool is available, so allocations are being edited as percentage
          shares. Dollar projections will return automatically once the pool is funded.
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!isValid || !canAct || saving}
          isLoading={saving}
          onClick={handleSave}
        >
          Save Allocations
        </Button>
        {!isValid && (
          <span className="text-sm text-error">
            {amountMode
              ? `Entered funding must match the live pool (${formatMoney(symbol, totalPool)}).`
              : `Shares must total 100% (currently ${totalDraft.toFixed(1)}%).`}
          </span>
        )}
        {feedback && (
          <span
            className={`text-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
          >
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  );
}
