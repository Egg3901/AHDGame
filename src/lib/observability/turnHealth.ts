import * as Sentry from "@sentry/nextjs";
import { SLO_TAG } from "./slo";

/**
 * Emit a structured turn-health metric to Sentry after each turn.
 *
 * This is a normal-level captureMessage (i.e. not an error) that carries
 * structured tags + extras so you can query turn health trends in GlitchTip:
 *   - tag `component: turn`
 *   - tag `turn.health: ok | degraded | failed`
 *   - extra fields: turn number, duration, warning count, phase statuses
 *
 * Called from the cron turn route after `processTurn()` returns.
 */
export function captureTurnHealth(
  result: {
    success: boolean;
    turn: number;
    message: string;
    warnings: string[];
  },
  durationMs: number,
  phaseStatuses?: Record<string, { status: string }>
): void {
  const warningCount = result.warnings.length;
  const health = result.success ? (warningCount === 0 ? "ok" : "degraded") : "failed";

  // SLO signal: a turn counts against the turn-success budget only when a phase
  // actually failed (degraded-with-warnings still completed). Tagged before the
  // healthy-turn early return so every turn contributes to the budget query.
  Sentry.setTag(SLO_TAG.TURN_SUCCESS, health === "failed" ? "false" : "true");

  // Only capture if something interesting happened — skip healthy turns
  // to avoid flooding GlitchTip with noise.
  if (health === "ok") return;

  const phaseSummary = phaseStatuses
    ? Object.fromEntries(Object.entries(phaseStatuses).map(([k, v]) => [k, v.status]))
    : undefined;

  Sentry.captureMessage(
    `Turn #${result.turn} ${health}: ${warningCount} warning(s), ${Math.round(durationMs / 1000)}s`,
    {
      level: health === "failed" ? "error" : "warning",
      tags: {
        component: "turn",
        "turn.health": health,
      },
      extra: {
        turn: result.turn,
        durationMs,
        warningCount,
        warnings: result.warnings,
        ...(phaseSummary ? { phases: phaseSummary } : {}),
      },
    }
  );
}
