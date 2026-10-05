import type { OpeningMetricObservation } from "./openingObservation";

export interface ResetMetricHistoryPoint {
  turn: number;
  value: number;
}

export type ResetMetricHistory = Record<string, ResetMetricHistoryPoint[]>;

export const RESET_METRIC_HISTORY_CADENCE_TURNS = 12;
export const RESET_METRIC_HISTORY_LIMIT = 120;

export function validateMetricHistory(
  history: Readonly<ResetMetricHistory>,
  observations: Readonly<Record<string, OpeningMetricObservation>>,
  sourceTurn: number
): void {
  if (
    !Number.isSafeInteger(sourceTurn) ||
    sourceTurn < 1 ||
    Object.keys(history).length !== Object.keys(observations).length ||
    Object.keys(observations).some((id) => !history[id])
  ) {
    throw new Error("Metric history does not match its observation board");
  }
  for (const [id, series] of Object.entries(history)) {
    if (
      series.length === 0 ||
      series[0]!.turn !== sourceTurn ||
      series.length > RESET_METRIC_HISTORY_LIMIT ||
      series.some(
        (point, index) =>
          !Number.isSafeInteger(point.turn) ||
          !Number.isFinite(point.value) ||
          (index > 0 && point.turn <= series[index - 1]!.turn)
      )
    ) {
      throw new Error(`Metric history series is invalid for ${id}`);
    }
  }
}

export function metricHistoryDue(sourceTurn: number, turn: number): boolean {
  if (!Number.isSafeInteger(sourceTurn) || !Number.isSafeInteger(turn) || turn < sourceTurn) {
    throw new Error("Metric history cadence requires valid source and current turns");
  }
  return (turn - sourceTurn) % RESET_METRIC_HISTORY_CADENCE_TURNS === 0;
}

export function openingMetricHistory(
  observations: Readonly<Record<string, OpeningMetricObservation>>,
  sourceTurn: number
): ResetMetricHistory {
  if (!Number.isSafeInteger(sourceTurn) || sourceTurn < 1) {
    throw new Error("Metric history requires a positive opening turn");
  }
  return Object.fromEntries(
    Object.entries(observations).map(([id, observation]) => {
      if (
        observation.metricId !== id ||
        typeof observation.value !== "number" ||
        !Number.isFinite(observation.value)
      ) {
        throw new Error(`Metric history opening is invalid for ${id}`);
      }
      return [id, [{ turn: sourceTurn, value: observation.value }]];
    })
  );
}

export function appendMetricHistory(
  history: Readonly<ResetMetricHistory>,
  observations: Readonly<Record<string, OpeningMetricObservation>>,
  turn: number
): ResetMetricHistory {
  if (!Number.isSafeInteger(turn) || turn < 1) {
    throw new Error("Metric history requires a positive turn");
  }
  validateMetricHistory(
    history,
    observations,
    Math.min(...Object.values(history).map((s) => s[0]!.turn))
  );
  return Object.fromEntries(
    Object.entries(observations).map(([id, observation]) => {
      if (
        observation.metricId !== id ||
        typeof observation.value !== "number" ||
        !Number.isFinite(observation.value)
      ) {
        throw new Error(`Metric history observation is invalid for ${id}`);
      }
      const prior = history[id]!;
      const last = prior.at(-1);
      if (last?.turn === turn) {
        if (last.value !== observation.value) {
          throw new Error(`Metric history replay differs for ${id}`);
        }
        return [id, [...prior]];
      }
      if (last && last.turn > turn) throw new Error(`Metric history turn regressed for ${id}`);
      return [
        id,
        [...prior, { turn, value: observation.value }].slice(-RESET_METRIC_HISTORY_LIMIT),
      ];
    })
  );
}
