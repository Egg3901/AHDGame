"use client";

import { corridorVerdict, inflationTrendLabel } from "@/lib/centralBank/rateCorridor";
import type { TurnSnapshot } from "./centralBankTypes";

const WIDTH = 800;
const HEIGHT = 190;
const WINDOW = 60;

/**
 * The rate corridor (locked composite signature): the prime rate as a stepped
 * line over the inflation band - one glance answers "is the bank ahead of
 * inflation?", with a computed stance verdict beneath.
 */
export function RateCorridor({
  interestRateHistory,
  inflationHistory,
  primeRate,
  currentInflation,
}: {
  interestRateHistory: TurnSnapshot[];
  inflationHistory: TurnSnapshot[];
  primeRate: number;
  currentInflation: number;
}) {
  const rates = interestRateHistory.slice(-WINDOW);
  const inflation = inflationHistory.slice(-WINDOW);
  const verdict = corridorVerdict(primeRate, currentInflation);
  const trend = inflationTrendLabel(inflationHistory);

  const turns = [...rates, ...inflation].map((snapshot) => snapshot.turn);
  const minTurn = Math.min(...turns);
  const maxTurn = Math.max(...turns);
  const values = [...rates, ...inflation].map((snapshot) => snapshot.rate);
  const maxValue = Math.max(...values, primeRate, currentInflation, 1) * 1.15;

  const toX = (turn: number) =>
    maxTurn === minTurn ? WIDTH / 2 : ((turn - minTurn) / (maxTurn - minTurn)) * WIDTH;
  const toY = (value: number) => HEIGHT - 8 - (value / maxValue) * (HEIGHT - 24);

  // Prime rate renders as steps: hold the previous rate until the turn it changed.
  const stepPath = rates
    .map((snapshot, index) => {
      const x = toX(snapshot.turn);
      const y = toY(snapshot.rate);
      if (index === 0) return `M ${x},${y}`;
      return `L ${x},${toY(rates[index - 1].rate)} L ${x},${y}`;
    })
    .join(" ");

  const inflationLine = inflation
    .map((snapshot) => `${toX(snapshot.turn)},${toY(snapshot.rate)}`)
    .join(" ");
  const inflationBand =
    inflation.length >= 2
      ? `M ${inflationLine.split(" ").join(" L ")} L ${toX(inflation[inflation.length - 1].turn)},${HEIGHT} L ${toX(inflation[0].turn)},${HEIGHT} Z`
      : null;

  const hasSeries = rates.length >= 2 || inflation.length >= 2;
  const stanceClass =
    verdict.stance === "restrictive"
      ? "text-info"
      : verdict.stance === "accommodative"
        ? "text-warning"
        : "text-success";

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-card-border bg-card-muted px-4 py-2.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
          Rate Corridor · last {Math.max(rates.length, inflation.length)} turns
        </span>
        <span className="flex gap-4 font-mono text-[10px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3.5 bg-foreground" />
            prime rate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3.5 rounded-sm bg-warning/25" />
            inflation band
          </span>
        </span>
      </div>
      {hasSeries ? (
        <div className="relative px-3 pt-3">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="block h-48 w-full"
            role="img"
            aria-label="Prime rate over the inflation band"
          >
            {inflationBand && <path d={inflationBand} className="fill-warning/15" />}
            {inflation.length >= 2 && (
              <polyline
                points={inflationLine}
                fill="none"
                className="stroke-warning/60"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {rates.length >= 2 && (
              <path
                d={stepPath}
                fill="none"
                className="stroke-foreground"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <span className="absolute right-4 top-4 rounded-md border border-card-border bg-card-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
            {primeRate.toFixed(2)}%
          </span>
          <span className="absolute right-4 top-10 rounded-md border border-warning/30 bg-card-muted px-1.5 py-0.5 font-mono text-[10px] text-warning">
            {currentInflation.toFixed(2)}%
          </span>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm italic text-muted">
          Rate history fills in as turns process.
        </p>
      )}
      {hasSeries && (
        <div className="flex justify-between px-4 pb-1 font-mono text-[9px] text-muted/60">
          <span>T {minTurn}</span>
          <span>now</span>
        </div>
      )}
      <div className="border-t border-card-border/50 px-4 py-2.5 text-xs text-muted">
        <span className={`font-semibold ${stanceClass}`}>{verdict.copy}</span>{" "}
        <span className="text-muted/70">· {trend}</span>
      </div>
    </div>
  );
}
