"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui";
import { DenseSection, KVList, KVRow, Td, Th } from "./dense/DenseKit";
import { DenseLineChart } from "./dense/DenseLineChart";
import { INDEX_INCLUSION_THRESHOLD } from "@/lib/corporations/indexOwnership";
import { useCurrency } from "@/contexts/CurrencyContext";
import {
  CORPORATE_BOND_SPREAD_PREMIUM,
  CREDIT_RATING_THRESHOLDS,
  CREDIT_RATING_WEIGHTS,
  calculateCreditScore,
  getBondCouponRate,
  MAX_BOND_ISSUANCE_FRACTION,
  CORPORATE_CREDIT_MATURITY_HORIZON_TURNS,
} from "@/lib/constants/bonds";
import { assessMaturityLiquidity } from "@/lib/bonds/rules/maturityLiquidity";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
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
      hint: "Cash against annual interest and estimated coverage of bond repayments in the next half game year.",
    },
  };

function tierScoreRangeLabel(tierIndex: number): string {
  const min = CREDIT_RATING_THRESHOLDS[tierIndex][0];
  if (tierIndex === 0) return `≥${min}`;
  const prevMin = CREDIT_RATING_THRESHOLDS[tierIndex - 1][0];
  return `${min}-${prevMin - 1}`;
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

function CreditCompositeChart({ points }: { points: CorpHistoryPoint[] }) {
  const creditPts = points.filter(
    (p): p is CorpHistoryPoint & { creditComposite: number } =>
      typeof p.creditComposite === "number"
  );
  if (creditPts.length < 2) {
    return (
      <p className="py-2 text-xs text-muted">
        Composite history appears after at least two hourly turns with credit snapshots saved.
      </p>
    );
  }
  return (
    <DenseLineChart
      turns={creditPts.map((p) => p.turn)}
      series={[
        {
          label: "Composite",
          values: creditPts.map((p) => p.creditComposite),
          tone: "text-foreground",
        },
      ]}
      domain={[0, 100]}
      height={180}
      formatTick={(v) => v.toFixed(0)}
      ariaLabel="Composite credit score over time"
      tooltip={(i) => (
        <div className="font-mono tabular-nums text-foreground">
          {creditPts[i].creditComposite}/100
          {creditPts[i].creditRating ? ` ${creditPts[i].creditRating}` : ""}
        </div>
      )}
    />
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
  // (npv, newEquity, the slider bounds) operates in a single unit.
  const liqAnchor = toInternalFrom(
    corporation.liquidCapital,
    corporation.liquidCurrencyCode as Parameters<typeof toInternalFrom>[1]
  );

  const debtSliderBounds = useMemo(() => {
    if (!bondInfo.creditDiagnostics) return { min: 0, max: 0 };
    // The ceiling the POST actually enforces, straight from the server (#1198).
    // Modelling a raise this panel would refuse is worse than not modelling it:
    // the going-concern headroom alone can be ~75x the enforced one.
    if (bondInfo.maxAllowedIssuance !== undefined) {
      return { min: -bondInfo.totalDebt, max: Math.max(0, bondInfo.maxAllowedIssuance) };
    }
    // Fallback for a response from an older deploy.
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
    const repaymentScale = totalDebt > 0 && d < 0 ? newDebt / totalDebt : 1;
    const maturity = assessMaturityLiquidity({
      obligations: bondInfo.bonds.map((bond) => ({
        principalAnchor:
          (bond.totalIssuedAnchor ??
            toInternalFrom(
              bond.totalIssued,
              bond.currencyCode as Parameters<typeof toInternalFrom>[1]
            )) * repaymentScale,
        maturityTurn: bond.maturityTurn,
        matured: bond.matured,
        defaulted: bond.defaulted,
      })),
      liquidCapitalAnchor: newLiquid,
      incomePerTurn: cd.annualIncome / TURNS_PER_YEAR,
      annualCouponObligations: newAnnual,
      currentTurn: bondInfo.currentTurn,
      horizonTurns: CORPORATE_CREDIT_MATURITY_HORIZON_TURNS,
      turnsPerYear: TURNS_PER_YEAR,
    });
    return calculateCreditScore(newLiquid, newDebt, cd.annualIncome, newAnnual, newEquity, {
      bondDefaultCreditPenaltyActive: penalty,
      nearTermLiquidityScore: maturity.liquidityScore ?? undefined,
    });
  }, [bondInfo, liqAnchor, clampedDebtDelta, toInternalFrom]);

  const canSlideDebt = debtSliderBounds.max > debtSliderBounds.min;
  if (!bondInfo.creditDiagnostics || !whatIf) return null;

  return (
    <DenseSection title="What-if debt" meta="simplified, ignores issuance fees">
      <div className="space-y-2 py-1">
        <p className="text-xs text-muted">
          Raise or repay face value at your current average coupon. Cash moves one for one with the
          debt. Repayments are spread proportionally across existing bonds; estimated future income
          stays fixed.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="credit-debt-delta" className="text-xs text-muted">
            Change in debt
          </label>
          <span className="font-mono text-[13px] tabular-nums text-foreground">
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
            No range to explore: no debt to repay and no room to issue more, or debt is at the cap.
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-2 font-mono text-[11px] tabular-nums text-muted">
          <span>Repay up to {formatAmount(bondInfo.totalDebt)}</span>
          <span>
            Issue up to {formatAmount(debtSliderBounds.max)} (
            {bondInfo.issuanceLimitedBy === "exitEquity"
              ? "what you could realize by selling up"
              : bondInfo.issuanceLimitedBy === "perIssuance"
                ? "per-issuance cap"
                : "equity headroom"}
            )
          </span>
        </div>
        <KVList>
          <KVRow label="Simulated rating" value={whatIf.rating} />
          <KVRow label="Simulated composite" value={`${whatIf.compositeScore}/100`} />
          <KVRow
            label="New-issue coupon"
            value={`${getBondCouponRate(bondInfo.creditRating.primeRate, whatIf.rating).toFixed(2)}%`}
          />
        </KVList>
      </div>
    </DenseSection>
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

  if (bondLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!bondInfo?.creditRating) {
    return (
      <p className="border-y border-card-border py-2 text-xs text-muted">
        Credit rating data not available.{" "}
        <a href="#corp-bonds" className="text-foreground underline underline-offset-2">
          Bonds {bondsArrow}
        </a>
      </p>
    );
  }

  const cr = bondInfo.creditRating;
  const cd = bondInfo.creditDiagnostics;
  const hint =
    improvementHint(
      cr.compositeScore,
      cr.rating,
      Boolean(bondInfo.bondDefaultCreditPenalty?.active)
    ) ??
    (CREDIT_RATINGS.indexOf(cr.rating as CreditRating) === 0 ? "At the top published tier." : null);

  return (
    <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {bondInfo.bondDefaultCreditPenalty?.active && (
          <p role="status" className="border-y border-error/40 py-2 text-xs text-foreground">
            <span className="font-semibold text-error">Default penalty.</span> The rating is held at
            CCC after a bond default
            {bondInfo.bondDefaultCreditPenalty.untilTurn != null
              ? ` until turn ${bondInfo.bondDefaultCreditPenalty.untilTurn}`
              : ""}
            .
          </p>
        )}

        <DenseSection
          title="Credit rating"
          meta="recalculated each turn"
          actions={
            <a
              href="#corp-bonds"
              className="text-xs text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
            >
              Bonds and issuance {bondsArrow}
            </a>
          }
        >
          <div className="grid gap-x-8 sm:grid-cols-2">
            <KVList>
              <KVRow
                label="Rating"
                value={
                  <span
                    className={
                      cr.compositeScore >= 70
                        ? "text-success"
                        : cr.compositeScore >= 40
                          ? "text-warning"
                          : "text-error"
                    }
                  >
                    {cr.rating}
                  </span>
                }
              />
              <KVRow
                label="Composite"
                value={`${cr.compositeScore}/100`}
                title={`Built from ${Math.round(CREDIT_RATING_WEIGHTS.debtToEquity * 100)}% debt, ${Math.round(CREDIT_RATING_WEIGHTS.interestCoverage * 100)}% interest cover, ${Math.round(CREDIT_RATING_WEIGHTS.profitability * 100)}% profit and ${Math.round(CREDIT_RATING_WEIGHTS.liquidity * 100)}% cash.`}
              />
            </KVList>
            <KVList>
              <KVRow
                label="Coupon on new issues"
                value={`${cr.effectiveCouponRate.toFixed(2)}%`}
                hint={`prime ${cr.primeRate.toFixed(2)} + ${CREDIT_RATING_SPREADS[cr.rating as CreditRating].toFixed(2)} + ${CORPORATE_BOND_SPREAD_PREMIUM.toFixed(2)}`}
                title="Prime, plus your tier's spread, plus the corporate premium."
              />
              {corporation.indexOwnershipPercent != null &&
                corporation.indexOwnershipPercent > 0 && (
                  <KVRow
                    label="Index funds hold"
                    value={`${corporation.indexOwnershipPercent}%`}
                    hint={
                      corporation.indexInclusionActive
                        ? "one-notch upgrade"
                        : `${Math.round(INDEX_INCLUSION_THRESHOLD * 100)}% earns a notch`
                    }
                  />
                )}
            </KVList>
          </div>
          {hint && <p className="pt-1.5 text-xs text-muted">{hint}</p>}
          <table className="mt-2 w-full border-collapse">
            <thead>
              <tr>
                <Th>Component</Th>
                <Th align="right">Weight</Th>
                <Th align="right">Score</Th>
                <Th className="hidden sm:table-cell">Basis</Th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(CREDIT_RATING_WEIGHTS) as (keyof typeof CREDIT_RATING_WEIGHTS)[]).map(
                (key) => {
                  const value = cr.components[key];
                  const copy = COMPONENT_COPY[key];
                  const detail =
                    key === "debtToEquity"
                      ? cd?.debtToEquityRatio != null
                        ? `${cd.debtToEquityRatio.toFixed(2)}x debt to equity`
                        : null
                      : key === "interestCoverage"
                        ? cd?.interestCoverageRatio != null
                          ? `${cd.interestCoverageRatio.toFixed(1)}x income over coupons`
                          : cd && cd.annualCouponObligations <= 0
                            ? "No coupon burden"
                            : null
                        : key === "profitability"
                          ? cd && cd.totalEquity > 0
                            ? `${((cd.annualIncome / cd.totalEquity) * 100).toFixed(1)}% return on equity`
                            : null
                          : `${formatAmount(liquidCapitalAnchor)} cash on hand`;
                  return (
                    <tr key={key}>
                      <Td className="text-foreground" title={copy.hint}>
                        {copy.label}
                      </Td>
                      <Td align="right" className="text-muted">
                        {Math.round(CREDIT_RATING_WEIGHTS[key] * 100)}%
                      </Td>
                      <Td align="right">
                        <span className="inline-flex items-center gap-2">
                          {value}
                          <span
                            aria-hidden
                            className="hidden h-1 w-12 overflow-hidden rounded-sm bg-card-elevated sm:inline-block"
                          >
                            <span
                              className="block h-full bg-foreground/60"
                              style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                            />
                          </span>
                        </span>
                      </Td>
                      <Td className="hidden text-xs text-muted sm:table-cell">{detail ?? ""}</Td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </DenseSection>

        {cr.couponRatesByDuration && (
          <DenseSection title="Coupon by maturity" meta={`at ${cr.rating}`}>
            <table className="w-full max-w-md border-collapse">
              <thead>
                <tr>
                  <Th>Maturity</Th>
                  <Th align="right">Turns</Th>
                  <Th align="right">Coupon</Th>
                </tr>
              </thead>
              <tbody>
                {([96, 240, 336] as const).map((turns) => (
                  <tr key={turns}>
                    <Td className="text-foreground">{Math.round(turns / 48)} years</Td>
                    <Td align="right" className="text-muted">
                      {turns}
                    </Td>
                    <Td align="right">
                      {(cr.couponRatesByDuration[turns] ?? cr.effectiveCouponRate).toFixed(2)}%
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DenseSection>
        )}

        <DenseSection title="History" meta="end-of-turn composite">
          <p className="py-1 text-xs text-muted">
            Tier changes also go out on the{" "}
            <Link href="/news" className="text-foreground underline underline-offset-2">
              wire
            </Link>{" "}
            and in your notifications.
          </p>
          <CreditCompositeChart points={history} />
        </DenseSection>

        {cd && (
          <WhatIfDebtPanel
            key={`whatif-${bondInfo.totalDebt}-${cd.totalEquity}`}
            bondInfo={bondInfo}
            corporation={corporation}
          />
        )}
      </div>

      <aside className="min-w-0 space-y-6">
        <DenseSection title="Balance sheet context">
          <KVList>
            <KVRow label="Outstanding debt" value={formatAmount(bondInfo.totalDebt)} />
            <KVRow label="Liquid capital" value={formatAmount(liquidCapitalAnchor)} />
            <KVRow
              label="Active bond issues"
              value={bondInfo.bonds.filter((b) => !b.matured && !b.defaulted).length}
            />
            {cd && (
              <>
                <KVRow
                  label="Book equity"
                  value={formatAmount(cd.totalEquity)}
                  title="Cash plus the estimated worth of working sectors: what the score measures debt and profit against."
                />
                <KVRow label="Annual income (est.)" value={formatAmount(cd.annualIncome)} />
                <KVRow label="Annual coupons" value={formatAmount(cd.annualCouponObligations)} />
                <KVRow
                  label="Debt to equity"
                  value={cd.debtToEquityRatio != null ? cd.debtToEquityRatio.toFixed(2) : "n/a"}
                />
                <KVRow
                  label="Coverage"
                  value={
                    cd.interestCoverageRatio != null
                      ? `${cd.interestCoverageRatio.toFixed(2)}x`
                      : cd.annualCouponObligations <= 0
                        ? "No coupons"
                        : "n/a"
                  }
                  title="Estimated annual income over annual coupons."
                />
              </>
            )}
          </KVList>
        </DenseSection>

        {peerStats && (
          <DenseSection title="Peers" meta="rated corporations">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th />
                  <Th align="right">Country</Th>
                  <Th align="right">Sector</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td className="text-muted">Peers</Td>
                  <Td align="right">{peerStats.countryPeers?.n ?? "n/a"}</Td>
                  <Td align="right">{peerStats.sectorPeers?.n ?? "n/a"}</Td>
                </tr>
                <tr>
                  <Td className="text-muted">Avg composite</Td>
                  <Td align="right">{peerStats.countryPeers?.avgComposite ?? "n/a"}</Td>
                  <Td align="right">{peerStats.sectorPeers?.avgComposite ?? "n/a"}</Td>
                </tr>
                <tr>
                  <Td className="text-muted">Avg new-issue coupon</Td>
                  <Td align="right">
                    {peerStats.countryPeers
                      ? `${peerStats.countryPeers.avgNewIssueCouponPct.toFixed(2)}%`
                      : "n/a"}
                  </Td>
                  <Td align="right">
                    {peerStats.sectorPeers
                      ? `${peerStats.sectorPeers.avgNewIssueCouponPct.toFixed(2)}%`
                      : "n/a"}
                  </Td>
                </tr>
              </tbody>
            </table>
            {typeof peerStats.you.composite === "number" && peerStats.countryPeers && (
              <p className="pt-1.5 text-xs text-muted">
                You are{" "}
                <span className="font-mono text-foreground">
                  {(peerStats.you.composite - peerStats.countryPeers.avgComposite).toFixed(1)}
                </span>{" "}
                points from the country average.
              </p>
            )}
          </DenseSection>
        )}

        <DenseSection title="Rating scale" meta="coupon add-on over prime">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Rating</Th>
                <Th align="right">Composite</Th>
                <Th align="right">Add-on</Th>
              </tr>
            </thead>
            <tbody>
              {CREDIT_RATING_THRESHOLDS.map(([, grade], i) => {
                const current = grade === cr.rating;
                return (
                  <tr
                    key={grade}
                    className={current ? "bg-card-elevated/60 font-semibold" : undefined}
                  >
                    <Td className={current ? "text-foreground" : "text-muted"}>
                      {grade}
                      {current && (
                        <span className="ml-1.5 text-[11px] font-normal text-muted">you</span>
                      )}
                    </Td>
                    <Td align="right" className={current ? "text-foreground" : "text-muted"}>
                      {tierScoreRangeLabel(i)}
                    </Td>
                    <Td align="right" className={current ? "text-foreground" : "text-muted"}>
                      +{(CREDIT_RATING_SPREADS[grade] + CORPORATE_BOND_SPREAD_PREMIUM).toFixed(1)}%
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DenseSection>
      </aside>
    </div>
  );
}
