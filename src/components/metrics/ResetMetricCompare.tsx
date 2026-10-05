"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CategoryIcon } from "@/app/country/[code]/political-metrics/components/categoryIcons";
import { scoreTone } from "@/app/country/[code]/political-metrics/components/tones";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { currencySymbolSep } from "@/lib/currency/symbolSep";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import type {
  ResetMetricBoardResponse,
  ResetMetricCountry,
  ResetMetricRow,
} from "./ResetMetricBoard";

const NATIONAL_COUNTRIES: readonly ResetMetricCountry[] = ["US", "UK", "JP"];
const MAX_REGION_PEERS = 3;

const CATEGORY_ICONS: Record<string, string> = {
  economic: "currency",
  social: "users",
  governance: "library",
  education: "cap",
  healthcare: "heart",
  infrastructure: "building",
  publicSafety: "scales",
  environment: "globe",
  mediaInformation: "library",
  population: "users",
  security: "shield",
};

type ComparisonTarget = {
  key: string;
  name: string;
  countryId: ResetMetricCountry;
  regionId: string | null;
};

type MetricDetailResponse = {
  regions: Array<{ regionId: string; name: string; value: number }>;
};

function targetKey(countryId: ResetMetricCountry, regionId: string | null) {
  return regionId ? `${countryId}:${regionId}` : countryId;
}

function categoryId(metric: ResetMetricRow) {
  return metric.path.split(".")[0] ?? "other";
}

function readableCategory(category: string) {
  return category
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function conditionAverage(board: ResetMetricBoardResponse, category?: string): number | null {
  const scores = board.metrics
    .filter((metric) => !category || categoryId(metric) === category)
    .map((metric) => metric.conditionScore)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (scores.length === 0) return null;
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function valueLabel(metric: ResetMetricRow, countryId: ResetMetricCountry) {
  const value = metric.observation.value;
  if (value === null) return "Unavailable";
  if (metric.id === "02") {
    const symbol = getCurrencyPrefix(countryId);
    const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
    return `${symbol}${currencySymbolSep(symbol)}${formatted}`;
  }
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
  }).format(value);
  return `${formatted}${metric.unit.startsWith("%") ? "" : " "}${metric.unit}`;
}

function Score({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">n/a</span>;
  const tone = scoreTone(value);
  return (
    <span className={`font-bold tabular-nums ${tone.text}`}>
      {Math.round(value)}
      <span className="text-[10px] font-normal text-muted">/100</span>
    </span>
  );
}

export function ResetMetricCompare({
  home,
  homeName,
  regionLabel,
  initialCategoryId,
  onBack,
}: {
  home: ResetMetricBoardResponse;
  homeName: string;
  regionLabel: string;
  initialCategoryId?: string;
  onBack: () => void;
}) {
  const homeKey = targetKey(home.countryId, home.regionId);
  const isNational = home.scope === "national";
  const [targets, setTargets] = useState<ComparisonTarget[]>(() =>
    isNational
      ? NATIONAL_COUNTRIES.map((countryId) => ({
          key: countryId,
          countryId,
          regionId: null,
          name: COUNTRY_CONFIGS[countryId].name,
        }))
      : []
  );
  const [selected, setSelected] = useState<string[]>(() =>
    isNational ? [...NATIONAL_COUNTRIES] : []
  );
  const [boards, setBoards] = useState<
    Record<string, ResetMetricBoardResponse | null | "loading" | undefined>
  >({ [homeKey]: home });
  const requested = useRef(new Set([homeKey]));
  const [openCategory, setOpenCategory] = useState<string | null>(initialCategoryId ?? null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const regionalMetric = useMemo(
    () => home.metrics.find((metric) => metric.aggregation !== "national"),
    [home.metrics]
  );
  const targetMessage =
    targetError ??
    (!isNational && !regionalMetric
      ? "No regional comparison series is available for this board."
      : null);

  useEffect(() => {
    if (isNational) return;
    if (!regionalMetric) return;
    const controller = new AbortController();
    void fetch(`/api/country/${home.countryId}/reset-metrics/${regionalMetric.id}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Region list could not be loaded");
        return (await response.json()) as MetricDetailResponse;
      })
      .then((detail) => {
        setTargets(
          detail.regions
            .filter((region) => region.regionId !== home.regionId)
            .map((region) => ({
              key: targetKey(home.countryId, region.regionId),
              countryId: home.countryId,
              regionId: region.regionId,
              name: region.name,
            }))
            .sort((left, right) => left.name.localeCompare(right.name))
        );
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setTargetError(cause instanceof Error ? cause.message : "Region list could not be loaded");
      });
    return () => controller.abort();
  }, [home.countryId, home.regionId, isNational, regionalMetric]);

  useEffect(() => {
    const pending = new Map<string, AbortController>();
    const settled = new Set<string>();
    const requestSet = requested.current;
    for (const key of selected) {
      const target = targets.find((candidate) => candidate.key === key);
      if (!target || requestSet.has(key)) continue;
      requestSet.add(key);
      const controller = new AbortController();
      pending.set(key, controller);
      setBoards((current) => ({ ...current, [key]: "loading" }));
      const query = target.regionId ? `?region=${encodeURIComponent(target.regionId)}` : "";
      void fetch(`/api/country/${target.countryId}/reset-metrics${query}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Comparison board could not be loaded");
          return (await response.json()) as ResetMetricBoardResponse;
        })
        .then((board) => {
          const expectedScope = target.regionId ? "regional" : "national";
          if (
            board.countryId !== target.countryId ||
            board.regionId !== target.regionId ||
            board.scope !== expectedScope
          ) {
            throw new Error("Comparison board did not match the requested jurisdiction");
          }
          setBoards((current) => ({ ...current, [key]: board }));
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          requestSet.delete(key);
          setBoards((current) => ({ ...current, [key]: null }));
        })
        .finally(() => settled.add(key));
    }
    return () => {
      for (const [key, controller] of pending) {
        if (!settled.has(key)) requestSet.delete(key);
        controller.abort();
      }
    };
  }, [selected, targets]);

  const categories = useMemo(() => [...new Set(home.metrics.map(categoryId))], [home.metrics]);
  const columns = useMemo(() => {
    if (isNational) return targets.filter((target) => selected.includes(target.key));
    return [
      {
        key: homeKey,
        countryId: home.countryId,
        regionId: home.regionId,
        name: homeName,
      },
      ...targets.filter((target) => selected.includes(target.key)),
    ];
  }, [home.countryId, home.regionId, homeKey, homeName, isNational, selected, targets]);

  function toggleTarget(key: string) {
    setSelected((current) => {
      if (current.includes(key)) {
        if (isNational && current.length === 1) return current;
        return current.filter((candidate) => candidate !== key);
      }
      if (!isNational && current.length >= MAX_REGION_PEERS) return current;
      return [...current, key];
    });
  }

  return (
    <section className="mt-4 flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← {homeName} overview
        </Button>
        <span className="font-mono text-body-xs uppercase tracking-widest text-muted">
          {isNational
            ? "Compare national registries"
            : `Compare up to ${MAX_REGION_PEERS} ${regionLabel.toLowerCase()} peers`}
        </span>
      </div>

      <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
        <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
          Compare against
        </div>
        <div className="flex flex-wrap gap-1.5">
          {targets.map((target) => {
            const on = selected.includes(target.key);
            const full = !isNational && !on && selected.length >= MAX_REGION_PEERS;
            return (
              <button
                key={target.key}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() => toggleTarget(target.key)}
                className={`rounded border px-2.5 py-1 font-mono text-body-xs transition-colors ${
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : full
                      ? "cursor-not-allowed border-card-border text-muted/40"
                      : "border-card-border text-muted hover:border-muted hover:text-foreground"
                }`}
              >
                {target.name}
              </button>
            );
          })}
        </div>
        {targetMessage && <p className="mt-2 text-body-sm text-error">{targetMessage}</p>}
        {!isNational && selected.length === 0 && !targetMessage && (
          <p className="mt-2 text-body-sm text-muted">
            Select a {regionLabel.toLowerCase()} to place its v2 observations beside {homeName}.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-card-border bg-card shadow-card">
        <table className="w-full min-w-[44rem] border-collapse">
          <thead>
            <tr className="border-b border-card-border">
              <th className="px-4 py-2 text-left font-mono text-body-xs uppercase tracking-wider text-muted">
                Outcome domain
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-4 py-2 text-right font-mono text-body-xs uppercase tracking-wider ${column.key === homeKey ? "text-primary" : "text-muted"}`}
                >
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-card-border bg-card-muted/40">
              <td className="px-4 py-2.5 text-body-sm font-bold text-foreground">
                Overall condition
              </td>
              {columns.map((column) => (
                <td key={column.key} className="px-4 py-2.5 text-right text-body">
                  {boards[column.key] === undefined || boards[column.key] === "loading" ? (
                    <span className="text-body-xs text-muted">loading...</span>
                  ) : boards[column.key] === null ? (
                    <span className="text-body-xs text-error">unavailable</span>
                  ) : (
                    <Score
                      value={conditionAverage(boards[column.key] as ResetMetricBoardResponse)}
                    />
                  )}
                </td>
              ))}
            </tr>
            {categories.flatMap((id) => {
              const isOpen = openCategory === id;
              const metrics = home.metrics.filter((metric) => categoryId(metric) === id);
              return [
                <tr key={id} className="border-b border-card-border/50 hover:bg-card-muted/40">
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} ${readableCategory(id)} metrics`}
                      onClick={() => setOpenCategory(isOpen ? null : id)}
                      className="flex w-full items-center gap-2 text-left text-body-sm text-foreground"
                    >
                      <span className="text-primary">
                        <CategoryIcon icon={CATEGORY_ICONS[id] ?? "library"} className="h-4 w-4" />
                      </span>
                      {readableCategory(id)}
                      <span className="text-muted" aria-hidden="true">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </button>
                  </td>
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-2.5 text-right text-body">
                      {boards[column.key] && boards[column.key] !== "loading" ? (
                        <Score
                          value={conditionAverage(
                            boards[column.key] as ResetMetricBoardResponse,
                            id
                          )}
                        />
                      ) : (
                        <span className="text-muted">n/a</span>
                      )}
                    </td>
                  ))}
                </tr>,
                ...(isOpen
                  ? metrics.map((metric) => (
                      <tr key={metric.id} className="border-b border-card-border/30">
                        <td className="py-2 pl-10 pr-4 text-body-sm text-muted">{metric.name}</td>
                        {columns.map((column) => {
                          const comparisonBoard = boards[column.key];
                          const comparisonMetric =
                            comparisonBoard && comparisonBoard !== "loading"
                              ? comparisonBoard.metrics.find(
                                  (candidate) => candidate.id === metric.id
                                )
                              : undefined;
                          return (
                            <td key={column.key} className="px-4 py-2 text-right">
                              {comparisonMetric ? (
                                <div>
                                  <div className="text-body-sm tabular-nums text-foreground">
                                    {valueLabel(comparisonMetric, column.countryId)}
                                  </div>
                                  <div className="text-[10px] uppercase tracking-wide text-muted">
                                    <Score value={comparisonMetric.conditionScore} /> condition
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted">n/a</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>

      <p className="text-body-xs leading-relaxed text-muted">
        Condition scores provide the common 0 to 100 comparison. Expanded rows retain each
        registry&apos;s actual units and local currency, so equal scores do not imply identical raw
        values or institutions.
      </p>
    </section>
  );
}

export default ResetMetricCompare;
