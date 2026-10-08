"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ownershipChanges,
  ownershipSeries,
  type OwnershipHistory,
} from "@/lib/corporations/ownership/rules";
import type { CorporationDetail } from "../CorporationPageTypes";
import { DenseSection, SmallButton, TableScroll, Th, Td } from "../dense/DenseKit";
import { currentOwnerKey } from "./OwnershipOverview";

const percent = (value: number) => `${value.toFixed(1)}%`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;

export default function OwnershipHistoryPanel({
  corpId,
  corporation,
}: {
  corpId: string;
  corporation: CorporationDetail;
}) {
  const t = useTranslations("corporations.ownership");
  const [turns, setTurns] = useState(96);
  const [result, setResult] = useState<{
    key: string;
    data: OwnershipHistory | null;
    failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement>(null);
  const [chartWidth, setChartWidth] = useState(800);

  const requestKey = `${corpId}:${turns}:${attempt}`;
  const data = result?.key === requestKey ? result.data : null;
  const failed = result?.key === requestKey && result.failed;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/corporations/${corpId}/shares/ownership?turns=${turns}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("ownership history unavailable");
        const history: OwnershipHistory = await response.json();
        if (!controller.signal.aborted)
          setResult({ key: requestKey, data: history, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data: null, failed: true });
      });
    return () => controller.abort();
  }, [corpId, turns, requestKey]);

  const currentNames = new Map(
    corporation.shareholders.map((holder) => [currentOwnerKey(holder), holder.name])
  );
  const names = new Map(
    data?.owners.map((owner) => [owner.key, currentNames.get(owner.key) ?? owner.name]) ?? []
  );
  names.set("public_float", t("publicFloat"));
  const changes = ownershipChanges(data?.snapshots ?? []);
  const options = [...(data?.owners ?? [])].sort((a, b) =>
    (currentNames.get(a.key) ?? a.name).localeCompare(currentNames.get(b.key) ?? b.name)
  );
  const topHolderKey = corporation.shareholders
    .slice()
    .sort((a, b) => b.shares - a.shares)
    .map(currentOwnerKey)
    .find((key) => names.has(key));
  const key = names.has(selectedKey)
    ? selectedKey
    : (topHolderKey ?? options[0]?.key ?? "public_float");
  const points = ownershipSeries(data?.snapshots ?? [], key);
  const pointIndex = Math.min(selectedIndex ?? points.length - 1, points.length - 1);
  const point = points[pointIndex];
  const x = (index: number) => 45 + (index / Math.max(1, points.length - 1)) * (chartWidth - 70);
  const y = (value: number) => 190 - value * 1.6;
  const path = points
    .map((p, index) => {
      if (p.percent === null) {
        return "";
      }
      const command = points[index - 1]?.percent != null ? "L" : "M";
      return `${command}${x(index)},${y(p.percent)}`;
    })
    .join(" ");
  const hasRecorded = points.some((p) => p.percent !== null);
  useEffect(() => {
    if (!hasRecorded || !chartRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setChartWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, [hasRecorded]);

  return (
    <DenseSection
      title={t("historyTitle")}
      meta={t("turnSnapshots")}
      actions={
        <label className="flex items-center gap-2 text-xs text-muted">
          {t("range")}
          <select
            aria-label={t("range")}
            value={turns}
            onChange={(e) => {
              setTurns(Number(e.target.value));
              setSelectedIndex(null);
            }}
            className="rounded-sm border border-card-border bg-background px-2 py-1 text-foreground"
          >
            {[24, 96, 192].map((n) => (
              <option key={n} value={n}>
                {t("turns", { count: n })}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {failed ? (
        <div className="flex items-center gap-3 py-6">
          <p role="alert" className="text-sm text-error">
            {t("loadError")}
          </p>
          <SmallButton onClick={() => setAttempt((n) => n + 1)}>{t("retry")}</SmallButton>
        </div>
      ) : !data ? (
        <p role="status" className="py-8 text-sm text-muted">
          {t("loading")}
        </p>
      ) : !data.snapshots.length ? (
        <p className="py-8 text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="space-y-4 py-3">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <label className="min-w-0 text-xs text-muted">
              {t("trackHolder")}
              <select
                aria-label={t("trackHolder")}
                value={key}
                onChange={(e) => {
                  setSelectedKey(e.target.value);
                  setSelectedIndex(null);
                }}
                className="mt-1 block w-full max-w-72 rounded-sm border border-card-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                {options.map((owner) => (
                  <option key={owner.key} value={owner.key}>
                    {names.get(owner.key)}
                  </option>
                ))}
                <option value="public_float">{t("publicFloat")}</option>
              </select>
            </label>
            <div
              role="status"
              aria-label={t("selectedSnapshot")}
              aria-live="polite"
              className="text-right"
            >
              <div className="text-xs text-muted">
                {point ? t("turn", { turn: point.turn }) : t("noSnapshot")}
              </div>
              <div className="font-mono text-xl tabular-nums">
                {point?.percent == null ? t("noSnapshot") : percent(point.percent)}
              </div>
              <div className="text-xs text-muted">
                {point?.shares == null ? "" : t("shares", { count: point.shares })}
              </div>
            </div>
          </div>
          {hasRecorded ? (
            <>
              <svg
                ref={chartRef}
                viewBox={`0 0 ${chartWidth} 225`}
                preserveAspectRatio="none"
                className="h-52 w-full text-primary"
                role="img"
                aria-label={t("trendChart", { holder: names.get(key) ?? "" })}
                onPointerMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const chartX = ((event.clientX - rect.left) / rect.width) * chartWidth;
                  setSelectedIndex(
                    Math.max(
                      0,
                      Math.min(
                        points.length - 1,
                        Math.round(((chartX - 45) / (chartWidth - 70)) * (points.length - 1))
                      )
                    )
                  );
                }}
              >
                {[0, 25, 50, 75, 100].map((n) => (
                  <g key={n}>
                    <line
                      x1="45"
                      x2={chartWidth - 25}
                      y1={y(n)}
                      y2={y(n)}
                      stroke="var(--card-border)"
                      strokeWidth="0.7"
                    />
                    <text x="35" y={y(n) + 4} textAnchor="end" fill="var(--muted)" fontSize="11">
                      {n}%
                    </text>
                  </g>
                ))}
                <path
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                {points.map((p, i) =>
                  p.percent !== null &&
                  (points.length === 1 ||
                    (points[i - 1]?.percent == null && points[i + 1]?.percent == null)) ? (
                    <circle key={p.turn} cx={x(i)} cy={y(p.percent)} r="3" fill="currentColor" />
                  ) : null
                )}
                {point && (
                  <line
                    x1={x(pointIndex)}
                    x2={x(pointIndex)}
                    y1="30"
                    y2="190"
                    stroke="var(--muted)"
                    strokeDasharray="3 4"
                  />
                )}
                {point?.percent != null && (
                  <circle cx={x(pointIndex)} cy={y(point.percent)} r="4" fill="currentColor" />
                )}
                <text x="45" y="215" fill="var(--muted)" fontSize="11">
                  {t("turn", { turn: points[0].turn })}
                </text>
                <text
                  x={chartWidth - 25}
                  y="215"
                  textAnchor="end"
                  fill="var(--muted)"
                  fontSize="11"
                >
                  {t("turn", { turn: points[points.length - 1].turn })}
                </text>
              </svg>
              <input
                type="range"
                aria-label={t("inspectTurn")}
                aria-valuetext={point ? t("turn", { turn: point.turn }) : t("noSnapshot")}
                min={0}
                max={Math.max(0, points.length - 1)}
                value={Math.max(0, pointIndex)}
                onChange={(event) => setSelectedIndex(Number(event.target.value))}
                className="block h-4 w-full accent-primary"
              />
            </>
          ) : (
            <p className="py-4 text-sm text-muted">{t("missingRegisters")}</p>
          )}
          <p className="text-[11px] leading-relaxed text-muted">{t("historyExplanation")}</p>
          {changes && (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-card-border pb-2">
                <h3 className="text-xs font-semibold">{t("largestChanges")}</h3>
                <span className="text-[11px] text-muted">
                  {t("comparison", { first: changes.firstTurn, last: changes.lastTurn })}
                </span>
              </div>
              <TableScroll>
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <Th>{t("holder")}</Th>
                      <Th align="right">{t("start")}</Th>
                      <Th align="right">{t("end")}</Th>
                      <Th align="right">{t("stakeChange")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.changes.slice(0, 8).map((change) => (
                      <tr key={change.key} className="border-b border-card-border/60">
                        <Td>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedKey(change.key);
                              setSelectedIndex(null);
                            }}
                            className="max-w-48 truncate text-left hover:text-primary focus-visible:outline-primary"
                            title={names.get(change.key)}
                          >
                            {names.get(change.key)}
                            {change.after === 0 && change.before > 0 && (
                              <span className="ml-2 text-[10px] text-muted">{t("exited")}</span>
                            )}
                          </button>
                        </Td>
                        <Td numeric align="right">
                          {percent(change.beforePercent)}
                        </Td>
                        <Td numeric align="right">
                          {percent(change.afterPercent)}
                        </Td>
                        <Td numeric align="right">
                          <span
                            className={
                              change.change > 0
                                ? "text-success"
                                : change.change < 0
                                  ? "text-error"
                                  : "text-muted"
                            }
                          >
                            {t("percentagePoints", { value: signed(change.change) })}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>
          )}
        </div>
      )}
    </DenseSection>
  );
}
