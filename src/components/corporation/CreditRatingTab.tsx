"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui";
import { InfoTooltip } from "@/components/InfoTooltip";
import { Meter } from "@/components/corporation/market/MarketPrimitives";
import { INDEX_INCLUSION_THRESHOLD } from "@/lib/corporations/indexOwnership";
import { useCurrency } from "@/contexts/CurrencyContext";
import {
  CORPORATE_BOND_SPREAD_PREMIUM,
  CREDIT_RATING_THRESHOLDS,
  CREDIT_RATING_WEIGHTS,
  calculateCreditScore,
  getBondCouponRate,
  MAX_BOND_ISSUANCE_FRACTION,
} from "@/lib/constants/bonds";
import {
  CREDIT_RATING_SPREADS,
  CREDIT_RATINGS,
  type CreditRating,
} from "@/lib/db/types/centralBank";
import type { BondInfo, CorporationDetail, CorpHistoryPoint } from "./CorporationPageTypes";

interface CreditPeerStatsResponse {
  countryId: string;
  sectorType: string;
  you: { composite: number | null; rating: string | null };
  countryPeers: {
    n: number;
    avgComposite: number;
    avgNewIssueCouponPct: number;
  } | null;
  sectorPeers: {
    n: number;
    avgComposite: number;
    avgNewIssueCouponPct: number;
  } | null;
}

interface CreditRatingTabProps {
  bondInfo: BondInfo | null;
  bondLoading: boolean;
  corporation: CorporationDetail;
  corpId: string;
  modViewEnabled?: boolean;
  /** When the bonds/issuance section renders above this panel (CEO view), the
   *  jump links point up instead of down. */
  bondsAbove?: boolean;
}

const COMPONENT_COPY: Record<keyof typeof CREDIT_RATING_WEIGHTS, { label: string; hint: string }> =
  {
    debtToEquity: {
      label: "Debt vs what you own",
      hint: "Owe less compared to what the company is worth and you score higher.",
    },
    interestCoverage: {
      label: "Can profits cover the interest?",
      hint: "Whether last year's income was enough to pay a year of bond interest.",
    },
    profitability: {
      label: "Profit earned per unit owned",
      hint: "How much profit the company made for every unit of value it holds.",
    },
    liquidity: {
      label: "Cash cushion",
      hint: "Cash in hand against a year of bond interest. A bigger cushion scores higher.",
    },
  };

function tierScoreRangeLabel(tierIndex: number): string {
  const min = CREDIT_RATING_THRESHOLDS[tierIndex][0];
  if (tierIndex === 0) return `≥${min}`;
  const prevMin = CREDIT_RATING_THRESHOLDS[tierIndex - 1][0];
  return `${min}-${prevMin - 1}`;
}

function compositeFillClass(score: number): string {
  if (score >= 70) return "bg-success";
  if (score >= 40) return "bg-warning";
  return "bg-error";
}

function improvementHint(
  compositeScore: number,
  rating: string,
  penaltyActive: boolean
): string | null {
  if (penaltyActive) {
    return "A default penalty holds the rating at CCC until it expires. Improving the scores below still helps once that floor lifts.";
  }
  const idx = CREDIT_RATINGS.indexOf(rating as CreditRating);
  if (idx <= 0) return null;
  const better = CREDIT_RATINGS[idx - 1];
  const threshold = CREDIT_RATING_THRESHOLDS.find(([, g]) => g === better)?.[0];
  if (threshold == null) return null;
  const need = threshold - compositeScore;
  if (need <= 0) return null;
  return `Roughly ${need} more composite point${need === 1 ? "" : "s"} to reach ${better} (threshold ${threshold}).`;
}

const CHART_W = 560;
const CHART_H = 140;
const C_PAD = 36;

function CreditCompositeChart({ points }: { points: CorpHistoryPoint[] }) {
  const creditPts = points.filter(
    (p): p is CorpHistoryPoint & { creditComposite: number } =>
      typeof p.creditComposite === "number"
  );
  if (creditPts.length < 2) {
    return (
      <p className="text-xs text-muted">
        Composite history appears after at least two hourly turns with credit snapshots saved.
      </p>
    );
  }

  const minTurn = Math.min(...creditPts.map((p) => p.turn));
  const maxTurn = Math.max(...creditPts.map((p) => p.turn));
  const spanT = Math.max(1, maxTurn - minTurn);
  const innerW = CHART_W - C_PAD * 2;
  const innerH = CHART_H - C_PAD * 2;

  const pathD = creditPts
    .map((p, i) => {
      const x = C_PAD + ((p.turn - minTurn) / spanT) * innerW;
      const y = C_PAD + innerH - (p.creditComposite / 100) * innerH;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const last = creditPts[creditPts.length - 1];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full max-w-full h-auto text-foreground"
        role="img"
        aria-label="Composite credit score over time"
      >
        <rect
          x={C_PAD}
          y={C_PAD}
          width={innerW}
          height={innerH}
          className="fill-card-muted/40 stroke-card-border"
          strokeWidth={1}
          rx={4}
        />
        {[0, 25, 50, 75, 100].map((g) => {
          const y = C_PAD + innerH - (g / 100) * innerH;
          return (
            <g key={g}>
              <line
                x1={C_PAD}
                y1={y}
                x2={C_PAD + innerW}
                y2={y}
                className="stroke-card-border/60"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text x={4} y={y + 4} className="fill-muted text-[9px] tabular-nums">
                {g}
              </text>
            </g>
          );
        })}
        <path
          d={pathD}
          className="stroke-primary fill-none"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <text
          x={CHART_W - 4}
          y={14}
          textAnchor="end"
          className="fill-muted text-[9px] tabular-nums"
        >
          Turn {last.turn} · {last.creditComposite}
          {last.creditRating ? ` (${last.creditRating})` : ""}
        </text>
      </svg>
    </div>
  );
}

function WhatIfDebtPanel({
  bondInfo,
  corporation,
}: {
  bondInfo: BondInfo;
  corporation: CorporationDetail;
}) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const [debtDelta, setDebtDelta] = useState(0);

  // corporation.liquidCapital is denominated in corporation.liquidCurrencyCode
  // (native), but creditDiagnostics.totalEquity / bondInfo.totalDebt / coupon
  // obligations are all anchor-denominated (server uses liquidCapitalAnchor in
  // computeCorporateCreditAtTurn). Convert once to anchor so this panel's math
  // — npv, newEquity, the slider bounds — operates in a single unit.
  const liqAnchor = toInternalFrom(
    corporation.liquidCapital,
    corporation.liquidCurrencyCode as Parameters<typeof toInternalFrom>[1]
  );

  const debtSliderBounds = useMemo(() => {
    if (!bondInfo.creditDiagnostics) return { min: 0, max: 0 };
    const maxIssue = Math.max(
      0,
      bondInfo.creditDiagnostics.totalEquity * MAX_BOND_ISSUANCE_FRACTION - bondInfo.totalDebt
    );
    const perIssuanceCap = bondInfo.maxPerIssuance ?? 100_000_000;
    return { min: -bondInfo.totalDebt, max: Math.min(perIssuanceCap, maxIssue) };
  }, [bondInfo]);

  const clampedDebtDelta = Math.min(
    debtSliderBounds.max,
    Math.max(debtSliderBounds.min, debtDelta)
  );

  const whatIf = useMemo(() => {
    if (!bondInfo.creditDiagnostics || !bondInfo.creditRating) return null;
    const cd = bondInfo.creditDiagnostics;
    const liq = liqAnchor;
    const npv = cd.totalEquity - liq;
    const totalDebt = bondInfo.totalDebt;
    const annualCoupon = cd.annualCouponObligations;
    const eff = bondInfo.creditRating.effectiveCouponRate;
    const d = clampedDebtDelta;
    const newDebt = Math.max(0, totalDebt + d);
    const newLiquid = liq + d;
    const newAnnual =
      totalDebt > 0
        ? annualCoupon * (newDebt / totalDebt)
        : newDebt > 0
          ? newDebt * (eff / 100)
          : 0;
    const newEquity = newLiquid + npv;
    const penalty = bondInfo.bondDefaultCreditPenalty?.active ?? false;
    return calculateCreditScore(newLiquid, newDebt, cd.annualIncome, newAnnual, newEquity, {
      bondDefaultCreditPenaltyActive: penalty,
    });
  }, [bondInfo, liqAnchor, clampedDebtDelta]);

  const canSlideDebt = debtSliderBounds.max > debtSliderBounds.min;
  if (!bondInfo.creditDiagnostics || !whatIf) return null;

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
      <h3 className="text-sm font-bold uppercase tracking-widest text-muted mb-2">What-if debt</h3>
      <p className="text-xs text-muted mb-4 max-w-prose">
        Simulates raising or repaying face value at your <strong>current</strong> average coupon for
        proportional interest, and moves cash one-for-one with debt. Simplified: it ignores issuance
        fees.
      </p>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="credit-debt-delta" className="text-xs font-semibold text-muted">
            Δ Debt (face value)
          </label>
          <span className="text-sm tabular-nums font-medium text-foreground">
            {clampedDebtDelta >= 0 ? "+" : ""}
            {formatAmount(clampedDebtDelta)}
          </span>
        </div>
        {canSlideDebt ? (
          <input
            id="credit-debt-delta"
            type="range"
            min={debtSliderBounds.min}
            max={debtSliderBounds.max}
            step={100_000}
            value={clampedDebtDelta}
            onChange={(e) => setDebtDelta(Number(e.target.value))}
            className="w-full accent-primary"
          />
        ) : (
          <p className="text-xs text-muted">
            No range to explore. You have no debt and no room to issue more against what the company
            is worth, or your debt is already at the cap.
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted tabular-nums">
          <span>Repay up to {formatAmount(bondInfo.totalDebt)}</span>
          <span>
            Issue up to ~{formatAmount(debtSliderBounds.max)} (per-issuance cap or equity headroom)
          </span>
        </div>
        <div className="rounded-lg border border-card-border bg-card-elevated/50 px-4 py-3 flex flex-wrap gap-6 items-baseline">
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted">Simulated rating</p>
            <p className="text-2xl font-black tabular-nums text-foreground">{whatIf.rating}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted">Simulated composite</p>
            <p className="text-xl font-bold tabular-nums text-foreground">
              {whatIf.compositeScore}
              <span className="text-sm text-muted">/100</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted">
              Implied new-issue coupon
            </p>
            <p className="text-xl font-bold tabular-nums text-foreground">
              {getBondCouponRate(bondInfo.creditRating.primeRate, whatIf.rating).toFixed(2)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CreditRatingTab({
  bondInfo,
  bondLoading,
  corporation,
  corpId,
  modViewEnabled = false,
  bondsAbove = false,
}: CreditRatingTabProps) {
  const bondsArrow = bondsAbove ? "↑" : "↓";
  const { formatAmount, toInternalFrom } = useCurrency();
  const [history, setHistory] = useState<CorpHistoryPoint[]>([]);

  // liquidCapital is stored in the corp's native currency; convert to anchor
  // so formatAmount renders it consistently with bondInfo.totalDebt / equity.
  const liquidCapitalAnchor = toInternalFrom(
    corporation.liquidCapital,
    corporation.liquidCurrencyCode as Parameters<typeof toInternalFrom>[1]
  );
  const [peerStats, setPeerStats] = useState<CreditPeerStatsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const historyUrl = modViewEnabled
          ? `/api/corporations/${corpId}/history?modView=1`
          : `/api/corporations/${corpId}/history`;
        const [hRes, pRes] = await Promise.all([
          fetch(historyUrl),
          fetch(`/api/corporations/${corpId}/credit-peer-stats`),
        ]);
        if (cancelled) return;
        if (hRes.ok) {
          const j = await hRes.json();
          setHistory(Array.isArray(j.history) ? j.history : []);
        }
        if (pRes.ok) {
          setPeerStats(await pRes.json());
        }
      } catch {
        // ignore
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [corpId, modViewEnabled]);

  return (
    <div className="space-y-6">
      {bondLoading ? (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <Skeleton className="h-8 w-32 mb-4" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : bondInfo?.creditRating ? (
        <>
          {bondInfo.bondDefaultCreditPenalty?.active && (
            <div
              className="rounded-xl border border-error/35 bg-error/10 px-4 py-3 text-sm"
              role="status"
            >
              <p className="font-semibold text-error">Default credit penalty active</p>
              <p className="text-muted mt-1 text-xs leading-relaxed">
                Rating is floored at <span className="font-medium text-foreground">CCC</span> after
                a bond default.
                {bondInfo.bondDefaultCreditPenalty.untilTurn != null && (
                  <>
                    {" "}
                    Penalty clears after turn{" "}
                    <span className="tabular-nums font-medium text-foreground">
                      {bondInfo.bondDefaultCreditPenalty.untilTurn}
                    </span>
                    .
                  </>
                )}
              </p>
            </div>
          )}

          {/* Rating overview */}
          <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-foreground">Credit rating</h2>
                <p className="text-xs text-muted mt-0.5 max-w-prose">
                  Letter grade and composite score are recalculated each turn from leverage,
                  coverage, profitability, and liquidity.
                </p>
                {corporation.indexOwnershipPercent != null &&
                  corporation.indexOwnershipPercent > 0 && (
                    <p className="text-xs mt-1.5">
                      <span className="text-muted">Index funds hold </span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {corporation.indexOwnershipPercent}%
                      </span>
                      <span className="text-muted"> of shares. </span>
                      {corporation.indexInclusionActive ? (
                        <span className="font-semibold text-success">
                          Rating upgraded one notch for index inclusion.
                        </span>
                      ) : (
                        <span className="text-muted">
                          Reaching {Math.round(INDEX_INCLUSION_THRESHOLD * 100)}% earns a one-notch
                          upgrade.
                        </span>
                      )}
                    </p>
                  )}
              </div>
              <a
                href="#corp-bonds"
                className="text-sm font-semibold text-primary hover:underline shrink-0 self-start"
              >
                Bonds &amp; issuance {bondsArrow}
              </a>
            </div>

            <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
              {/* Left column — rating, composite, coupon, gauge */}
              <div className="space-y-6 lg:flex-[2] lg:min-w-0">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
                  <div
                    className={`text-5xl sm:text-6xl font-black tabular-nums tracking-tight ${
                      bondInfo.creditRating.compositeScore >= 70
                        ? "text-success"
                        : bondInfo.creditRating.compositeScore >= 40
                          ? "text-warning"
                          : "text-error"
                    }`}
                  >
                    {bondInfo.creditRating.rating}
                  </div>

                  <div className="flex flex-1 flex-col sm:flex-row sm:flex-wrap gap-4 sm:gap-8 min-w-0">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                        <InfoTooltip
                          trigger={
                            <span className="cursor-help border-b border-dotted border-muted/50">
                              Composite
                            </span>
                          }
                          width={260}
                        >
                          <p className="text-muted text-sm">
                            One score out of 100, built from four parts:{" "}
                            {Math.round(CREDIT_RATING_WEIGHTS.debtToEquity * 100)}% debt,{" "}
                            {Math.round(CREDIT_RATING_WEIGHTS.interestCoverage * 100)}% interest
                            cover, {Math.round(CREDIT_RATING_WEIGHTS.profitability * 100)}% profit,{" "}
                            {Math.round(CREDIT_RATING_WEIGHTS.liquidity * 100)}% cash. It sets the
                            letter grade shown below.
                          </p>
                        </InfoTooltip>
                      </p>
                      <p className="text-2xl font-bold tabular-nums text-foreground mt-0.5">
                        {bondInfo.creditRating.compositeScore}
                        <span className="text-base font-semibold text-muted">/100</span>
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                        <InfoTooltip
                          trigger={
                            <span className="cursor-help border-b border-dotted border-muted/50">
                              Coupon (new issues)
                            </span>
                          }
                          width={240}
                        >
                          <p className="text-muted text-sm">
                            Annual coupon rate for newly issued bonds at this rating: prime plus the
                            fixed spread for your tier.
                          </p>
                        </InfoTooltip>
                      </p>
                      <p className="text-2xl font-bold tabular-nums text-foreground mt-0.5">
                        {bondInfo.creditRating.effectiveCouponRate.toFixed(2)}%
                      </p>
                      <p className="text-xs text-muted mt-0.5 tabular-nums">
                        Prime {bondInfo.creditRating.primeRate.toFixed(2)}% +{" "}
                        {CREDIT_RATING_SPREADS[
                          bondInfo.creditRating.rating as CreditRating
                        ].toFixed(2)}
                        % tier + {CORPORATE_BOND_SPREAD_PREMIUM.toFixed(2)}% corporate
                      </p>
                    </div>
                  </div>
                </div>

                {/* Composite gauge */}
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wider text-muted">
                    <span>Composite scale</span>
                    <span className="tabular-nums">0-100</span>
                  </div>
                  <div className="relative h-3 rounded-full bg-card-muted border border-card-border/80 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${compositeFillClass(bondInfo.creditRating.compositeScore)}`}
                      style={{
                        width: `${Math.min(100, Math.max(0, bondInfo.creditRating.compositeScore))}%`,
                      }}
                    />
                    {CREDIT_RATING_THRESHOLDS.slice(0, -1).map(([threshold]) => (
                      <div
                        key={threshold}
                        className="absolute top-0 bottom-0 w-px bg-foreground/15 pointer-events-none"
                        style={{ left: `${threshold}%` }}
                        title={`Tier threshold ${threshold}`}
                      />
                    ))}
                  </div>
                  {(() => {
                    const hint = improvementHint(
                      bondInfo.creditRating.compositeScore,
                      bondInfo.creditRating.rating,
                      Boolean(bondInfo.bondDefaultCreditPenalty?.active)
                    );
                    const atTop =
                      CREDIT_RATINGS.indexOf(bondInfo.creditRating.rating as CreditRating) === 0;
                    const line = hint ?? (atTop ? "You are at the top published tier." : null);
                    return line ? <p className="text-xs text-muted">{line}</p> : null;
                  })()}
                </div>
              </div>

              {/* Divider */}
              <div className="hidden w-px self-stretch bg-card-border lg:block" />

              {/* Right column — composite components (subscores), inline with the rating */}
              <div className="lg:flex-[3] lg:min-w-0">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">
                  Composite components
                </p>
                <div className="space-y-3">
                  {(
                    Object.keys(CREDIT_RATING_WEIGHTS) as (keyof typeof CREDIT_RATING_WEIGHTS)[]
                  ).map((key) => {
                    const value = bondInfo.creditRating.components[key];
                    const weight = CREDIT_RATING_WEIGHTS[key];
                    const copy = COMPONENT_COPY[key];
                    const cd = bondInfo.creditDiagnostics;
                    const detail =
                      key === "debtToEquity"
                        ? cd?.debtToEquityRatio != null
                          ? `${cd.debtToEquityRatio.toFixed(2)}× debt / equity`
                          : null
                        : key === "interestCoverage"
                          ? cd?.interestCoverageRatio != null
                            ? `${cd.interestCoverageRatio.toFixed(1)}× income / coupons`
                            : cd && cd.annualCouponObligations <= 0
                              ? "No coupon burden"
                              : null
                          : key === "profitability"
                            ? cd && cd.totalEquity > 0
                              ? `${((cd.annualIncome / cd.totalEquity) * 100).toFixed(1)}% return on equity`
                              : null
                            : `${formatAmount(liquidCapitalAnchor)} cash on hand`;
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between gap-2 text-[12px]">
                          <InfoTooltip
                            trigger={
                              <span className="cursor-help text-foreground">
                                {copy.label}{" "}
                                <span className="text-muted">
                                  · {Math.round(weight * 100)}% weight
                                </span>
                              </span>
                            }
                            width={260}
                          >
                            <p className="text-muted text-sm">{copy.hint}</p>
                          </InfoTooltip>
                          <span className="shrink-0 font-semibold tabular-nums text-foreground">
                            {value}
                            <span className="text-muted">/100</span>
                          </span>
                        </div>
                        <div className="mt-1">
                          <Meter
                            value={value}
                            tone={value >= 75 ? "up" : value >= 55 ? "brand" : "warning"}
                            height={6}
                          />
                        </div>
                        {detail && <p className="mt-1 text-[11px] text-muted">{detail}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Indicative coupon by duration — the prototype's coupon curve */}
          {bondInfo.creditRating.couponRatesByDuration && (
            <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-muted">
                  Indicative coupon by duration
                </h3>
                <span className="text-xs text-muted">at {bondInfo.creditRating.rating}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {([96, 240, 336] as const).map((turns) => (
                  <div
                    key={turns}
                    className="rounded-lg border border-card-border bg-card-elevated/40 p-3 text-center"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                      {Math.round(turns / 48)}-yr <span className="text-muted/60">({turns}t)</span>
                    </div>
                    <div className="mt-1 font-mono text-xl font-bold tabular-nums text-primary">
                      {(
                        bondInfo.creditRating.couponRatesByDuration[turns] ??
                        bondInfo.creditRating.effectiveCouponRate
                      ).toFixed(2)}
                      %
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted">
                Coupon for newly issued bonds at each maturity, set by your rating. Issue bonds in
                the{" "}
                <a href="#corp-bonds" className="text-primary hover:underline">
                  bonds section {bondsArrow}
                </a>
                .
              </p>
            </div>
          )}

          {/* Composite / rating history */}
          <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted mb-2">History</h3>
            <p className="text-xs text-muted mb-4 max-w-prose">
              End-of-turn composite score (and letter grade in the chart label) from saved
              corporation history. Tier changes also hit the{" "}
              <Link href="/news" className="text-primary hover:underline">
                wire
              </Link>{" "}
              and your in-app notifications. There is no email for this.
            </p>
            <CreditCompositeChart points={history} />
          </div>

          {bondInfo.creditDiagnostics && (
            <WhatIfDebtPanel
              key={`whatif-${bondInfo.totalDebt}-${bondInfo.creditDiagnostics.totalEquity}`}
              bondInfo={bondInfo}
              corporation={corporation}
            />
          )}

          {/* Peer benchmarks */}
          {peerStats && (
            <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted mb-2">
                Peer context
              </h3>
              <p className="text-xs text-muted mb-4">
                Averages use other corporations in the same country (and same sector type) with a
                stored credit snapshot from the hourly turn processor.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-card-border/80 bg-card-elevated/30 p-3">
                  <p className="text-xs font-semibold text-muted mb-2">Same country</p>
                  {peerStats.countryPeers ? (
                    <ul className="space-y-1 text-muted text-xs">
                      <li className="flex justify-between gap-2">
                        <span>Peers (n)</span>
                        <span className="tabular-nums text-foreground">
                          {peerStats.countryPeers.n}
                        </span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>Avg composite</span>
                        <span className="tabular-nums text-foreground">
                          {peerStats.countryPeers.avgComposite}
                        </span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>Avg new-issue coupon @ prime</span>
                        <span className="tabular-nums text-foreground">
                          {peerStats.countryPeers.avgNewIssueCouponPct.toFixed(2)}%
                        </span>
                      </li>
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">No other rated peers in this country yet.</p>
                  )}
                </div>
                <div className="rounded-lg border border-card-border/80 bg-card-elevated/30 p-3">
                  <p className="text-xs font-semibold text-muted mb-2">Same sector type</p>
                  {peerStats.sectorPeers ? (
                    <ul className="space-y-1 text-muted text-xs">
                      <li className="flex justify-between gap-2">
                        <span>Peers (n)</span>
                        <span className="tabular-nums text-foreground">
                          {peerStats.sectorPeers.n}
                        </span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>Avg composite</span>
                        <span className="tabular-nums text-foreground">
                          {peerStats.sectorPeers.avgComposite}
                        </span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span>Avg new-issue coupon @ prime</span>
                        <span className="tabular-nums text-foreground">
                          {peerStats.sectorPeers.avgNewIssueCouponPct.toFixed(2)}%
                        </span>
                      </li>
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">No rated peers with this sector type yet.</p>
                  )}
                </div>
              </div>
              {typeof peerStats.you.composite === "number" && peerStats.countryPeers && (
                <p className="text-[11px] text-muted mt-3">
                  You are{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {(peerStats.you.composite - peerStats.countryPeers.avgComposite).toFixed(1)}
                  </span>{" "}
                  pts vs country average composite.
                </p>
              )}
            </div>
          )}

          {/* Diagnostics + debt summary */}
          <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted mb-4">
              Balance sheet context
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between gap-4 rounded-lg border border-card-border/80 bg-card-elevated/30 px-3 py-2.5">
                <span className="text-muted">Outstanding debt</span>
                <span className="font-medium tabular-nums text-right">
                  {formatAmount(bondInfo.totalDebt)}
                </span>
              </div>
              <div className="flex justify-between gap-4 rounded-lg border border-card-border/80 bg-card-elevated/30 px-3 py-2.5">
                <span className="text-muted">Liquid capital</span>
                <span className="font-medium tabular-nums text-right">
                  {formatAmount(liquidCapitalAnchor)}
                </span>
              </div>
              <div className="flex justify-between gap-4 rounded-lg border border-card-border/80 bg-card-elevated/30 px-3 py-2.5">
                <span className="text-muted">Active bond issues</span>
                <span className="font-medium tabular-nums text-right">
                  {bondInfo.bonds.filter((b) => !b.matured && !b.defaulted).length}
                </span>
              </div>
              {bondInfo.creditDiagnostics && (
                <>
                  <div className="flex justify-between gap-4 rounded-lg border border-card-border/80 bg-card-elevated/30 px-3 py-2.5">
                    <InfoTooltip
                      trigger={
                        <span className="text-muted cursor-help border-b border-dotted border-muted/40">
                          Book equity
                        </span>
                      }
                      width={240}
                    >
                      <p className="text-muted text-sm">
                        Cash on hand plus what your working sectors are estimated to be worth. This
                        is the value the credit score compares your debt and profit against.
                      </p>
                    </InfoTooltip>
                    <span className="font-medium tabular-nums text-right">
                      {formatAmount(bondInfo.creditDiagnostics.totalEquity)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 rounded-lg border border-card-border/80 bg-card-elevated/30 px-3 py-2.5">
                    <span className="text-muted">Annual income (est.)</span>
                    <span className="font-medium tabular-nums text-right">
                      {formatAmount(bondInfo.creditDiagnostics.annualIncome)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 rounded-lg border border-card-border/80 bg-card-elevated/30 px-3 py-2.5">
                    <span className="text-muted">Annual coupon obligations</span>
                    <span className="font-medium tabular-nums text-right">
                      {formatAmount(bondInfo.creditDiagnostics.annualCouponObligations)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 rounded-lg border border-card-border/80 bg-card-elevated/30 px-3 py-2.5">
                    <span className="text-muted">Debt / equity</span>
                    <span className="font-medium tabular-nums text-right">
                      {bondInfo.creditDiagnostics.debtToEquityRatio != null
                        ? bondInfo.creditDiagnostics.debtToEquityRatio.toFixed(2)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 rounded-lg border border-card-border/80 bg-card-elevated/30 px-3 py-2.5 sm:col-span-2">
                    <span className="text-muted">Income / coupons (coverage)</span>
                    <span className="font-medium tabular-nums text-right">
                      {bondInfo.creditDiagnostics.interestCoverageRatio != null
                        ? `${bondInfo.creditDiagnostics.interestCoverageRatio.toFixed(2)}×`
                        : bondInfo.creditDiagnostics.annualCouponObligations <= 0
                          ? "No coupon burden"
                          : "—"}
                    </span>
                  </div>
                </>
              )}
            </div>

            <details className="group mt-4 rounded-lg border border-card-border/60 bg-card-muted/20 px-3 py-2 text-xs text-muted">
              <summary className="cursor-pointer font-semibold text-foreground flex items-center gap-2 list-none [&::-webkit-details-marker]:hidden">
                <span
                  className="select-none text-muted transition-transform duration-200 group-open:rotate-90"
                  aria-hidden
                >
                  ▸
                </span>
                How the engine uses these numbers
              </summary>
              <ul className="mt-2 space-y-1.5 pl-4 list-disc marker:text-muted">
                <li>Debt-to-equity compares outstanding bonds to book equity.</li>
                <li>Coverage compares estimated annual income to annual coupon cash flows.</li>
                <li>Profitability scores return on that same equity figure.</li>
                <li>Liquidity compares cash on hand to annual coupons.</li>
              </ul>
            </details>
          </div>

          {/* Rating scale */}
          <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted mb-3">
              Published scale
            </h3>
            <p className="text-xs text-muted mb-4 max-w-prose">
              Composite thresholds; figures show total coupon add-on vs. prime (rating tier +{" "}
              {CORPORATE_BOND_SPREAD_PREMIUM.toFixed(1)}% corporate premium). Higher tiers mean
              cheaper new debt.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {CREDIT_RATING_THRESHOLDS.map(([_, grade], i) => (
                <div
                  key={grade}
                  className={`rounded-lg p-2.5 border text-center ${
                    grade === bondInfo.creditRating.rating
                      ? "border-primary bg-primary/10 text-primary font-bold ring-1 ring-primary/20"
                      : "border-card-border text-muted"
                  }`}
                >
                  <div className="text-sm font-bold tabular-nums">{grade}</div>
                  <div className="text-[10px] text-muted mt-1 tabular-nums leading-tight">
                    {tierScoreRangeLabel(i)}
                  </div>
                  <div className="text-[10px] mt-1 tabular-nums text-foreground/80">
                    +{(CREDIT_RATING_SPREADS[grade] + CORPORATE_BOND_SPREAD_PREMIUM).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center space-y-3">
          <p className="text-muted">Credit rating data not available.</p>
          <a
            href="#corp-bonds"
            className="inline-block text-sm font-semibold text-primary hover:underline"
          >
            Jump to bonds {bondsArrow}
          </a>
        </div>
      )}
    </div>
  );
}
