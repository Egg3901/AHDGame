/**
 * Rate-corridor verdict (locked composite signature): one glance answers
 * "is the bank ahead of inflation?" — computed, not editorial.
 */

export interface CorridorVerdict {
  delta: number;
  stance: "restrictive" | "neutral" | "accommodative";
  copy: string;
}

const NEUTRAL_BAND = 0.5;

export function corridorVerdict(primeRate: number, inflation: number): CorridorVerdict {
  const delta = primeRate - inflation;
  const stance =
    delta > NEUTRAL_BAND ? "restrictive" : delta < -NEUTRAL_BAND ? "accommodative" : "neutral";
  const signed = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
  const wording =
    stance === "restrictive"
      ? "restrictive stance"
      : stance === "accommodative"
        ? "accommodative stance"
        : "broadly neutral stance";
  const direction = delta >= 0 ? "above" : "below";
  return {
    delta,
    stance,
    copy: `Rate sits ${signed} ${direction} inflation — ${wording}.`,
  };
}

const TREND_THRESHOLD = 0.15;
const TREND_WINDOW = 12;

export function inflationTrendLabel(history: readonly { turn: number; rate: number }[]): string {
  if (history.length < 2) return "inflation steady";
  const window = history.slice(-TREND_WINDOW);
  const delta = window[window.length - 1].rate - window[0].rate;
  if (delta <= -TREND_THRESHOLD) return "inflation cooling";
  if (delta >= TREND_THRESHOLD) return "inflation rising";
  return "inflation steady";
}
