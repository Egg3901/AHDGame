"use client";

import { corridorVerdict, inflationTrendLabel } from "@/lib/centralBank/rateCorridor";
import type { TurnSnapshot } from "./centralBankTypes";
import { CentralBankSection } from "./CentralBankSection";

const WIDTH = 800;
const HEIGHT = 190;
const WINDOW = 60;

/**
 * The rate corridor (locked composite signature): the prime rate as a stepped
 * line over the inflation band. One glance answers "is the bank ahead of
 * inflation?", with a computed stance verdict beneath. A plain section, with
 * the chart drawn straight onto the page.
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
  const turnsShown = Math.max(rates.length, inflation.length);

  return (
    <CentralBankSection
      title="Rate corridor"
      meta={`Last ${turnsShown} ${turnsShown === 1 ? "turn" : "turns"}`}
      action={
        <span className="flex gap-4 text-body-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3.5 bg-foreground" />
            Prime rate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-3.5 rounded-sm bg-warning/25" />
            Inflation band
          </span>
        </span>
      }
    >
      {hasSeries ? (
        <div className="relative">
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
          <span className="absolute right-1 top-1 bg-background/80 px-1 text-body-sm font-semibold tabular-nums text-foreground">
            Prime {primeRate.toFixed(2)}%
          </span>
          <span className="absolute right-1 top-7 bg-background/80 px-1 text-body-sm font-semibold tabular-nums text-warning">
            Inflation {currentInflation.toFixed(2)}%
          </span>
        </div>
      ) : (
        <p className="py-8 text-center text-body text-muted">
          Rate history fills in as turns process.
        </p>
      )}
      {hasSeries && (
        <div className="mt-1 flex justify-between text-body-sm text-muted">
          <span>Turn {minTurn}</span>
          <span>Now</span>
        </div>
      )}
      <p className="mt-3 text-body text-foreground">
        <span className="font-semibold">{verdict.copy}</span>{" "}
        <span className="text-muted">Trend: {trend}.</span>
      </p>
    </CentralBankSection>
  );
}
