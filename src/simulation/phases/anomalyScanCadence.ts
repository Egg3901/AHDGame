import { SINGLEPLAYER_SKIP_PHASES } from "./singleplayerPhases";

/**
 * How often the anti-abuse scans run in a shared world.
 *
 * The three scans (financialSuspectScan, auditAnomalyScan, suspiciousDetection)
 * each look back over a rolling window: six turns for the two ledger scans,
 * three to fourteen days for alt detection. Nothing they flag depends on
 * running every turn; a transaction is inside the window for six turns
 * whether it is examined once or six times. What running every turn does
 * cost is ~18% of every document a turn deserializes, on every turn.
 *
 * Every third turn keeps every transaction inside at least one scanned
 * window with a turn to spare. The value must stay at or below the shortest
 * window (6) or coverage develops holes; the predicate clamps for that.
 *
 * `AHD_ANOMALY_SCAN_EVERY_TURNS=1` restores scanning on every turn without a
 * deploy, for when a moderator wants faster detection during an incident.
 */
export const ANOMALY_SCAN_EVERY_TURNS = 3;

/** Shortest rolling window among the scans; cadence must never exceed it. */
const SHORTEST_SCAN_WINDOW_TURNS = 6;

/** The same set singleplayer skips outright: detection, never gameplay. */
export const ANTI_ABUSE_SCAN_PHASES: ReadonlySet<string> = SINGLEPLAYER_SKIP_PHASES;

export function resolveAnomalyScanCadence(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.AHD_ANOMALY_SCAN_EVERY_TURNS;
  const parsed = raw === undefined || raw === "" ? ANOMALY_SCAN_EVERY_TURNS : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return ANOMALY_SCAN_EVERY_TURNS;
  return Math.min(parsed, SHORTEST_SCAN_WINDOW_TURNS);
}

/**
 * Phase predicate that lets the anti-abuse scans run only on turns that are
 * a multiple of the cadence. Undefined when the cadence is 1 (every turn),
 * so the runtime sees "no opinion" rather than a filter that always passes.
 */
export function getAnomalyScanCadencePredicate(
  currentTurn: number,
  everyTurns: number = resolveAnomalyScanCadence()
): ((phaseName: string) => boolean) | undefined {
  if (everyTurns <= 1) return undefined;
  const scanTurn = currentTurn % everyTurns === 0;
  return (phaseName: string) => scanTurn || !ANTI_ABUSE_SCAN_PHASES.has(phaseName);
}
