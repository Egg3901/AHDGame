/**
 * Actor-coverage report rendering (issue #1993).
 *
 * Pure formatting over the manifest: the prominent warnings reports must emit
 * when conclusions touch an actor-gated system that was partial or
 * unreachable, plus the checkpoint-verdict summary shape. Report scripts
 * (experiment, checkpoint) call these — they own all database reads and pass
 * the manifest in.
 */

import {
  actorCoverageWarnings,
  uncoveredEntries,
  type ActorCoverageManifest,
} from "./actorCoverage";

export const ACTOR_COVERAGE_SECTION_HEADING = "Actor coverage";

/** Report-ready rendering of one evaluated manifest. */
export interface ActorCoverageSection {
  heading: string;
  mode: string;
  preset: string;
  registryVersion: number;
  mechanicCount: number;
  coveredCount: number;
  uncoveredCount: number;
  /** Prominent per-mechanic warnings; empty when everything is covered. */
  warnings: string[];
  /** Human-readable lines for text/HTML reports, warnings first. */
  lines: string[];
}

/** Build the actor-coverage section for balance/experiment reports. */
export function buildActorCoverageSection(manifest: ActorCoverageManifest): ActorCoverageSection {
  const uncovered = uncoveredEntries(manifest);
  const warnings = actorCoverageWarnings(manifest);
  const coveredCount = manifest.entries.length - uncovered.length;
  const lines = [
    `${ACTOR_COVERAGE_SECTION_HEADING} (registry v${manifest.registryVersion}, ` +
      `mode ${manifest.mode}, preset ${manifest.preset}): ` +
      `${coveredCount}/${manifest.entries.length} mechanics covered.`,
    ...warnings,
  ];
  return {
    heading: ACTOR_COVERAGE_SECTION_HEADING,
    mode: manifest.mode,
    preset: manifest.preset,
    registryVersion: manifest.registryVersion,
    mechanicCount: manifest.entries.length,
    coveredCount,
    uncoveredCount: uncovered.length,
    warnings,
    lines,
  };
}

export interface ActorCoverageVerdict {
  status: "good" | "warn" | "bad";
  title: string;
  detail: string;
}

/**
 * One-line checkpoint verdict for the actor manifest. A null manifest (runs
 * that predate coverage stamping) warns rather than passing silently; any
 * partial/unreachable entry warns with the count, because those readings
 * constrain what the checkpoint can conclude — they are expected harness
 * limits in pure NPP mode, not engine defects, so they never read "bad".
 */
export function summarizeActorCoverageForVerdict(
  manifest: ActorCoverageManifest | null
): ActorCoverageVerdict {
  if (!manifest) {
    return {
      status: "warn",
      title: "Actor coverage: unknown (run predates manifest stamping)",
      detail:
        "This run recorded no actor-coverage manifest, so permanent vacancies, absent " +
        "campaigns, and empty wealth metrics cannot be distinguished from representative " +
        "behavior. Do not cite player-only systems from this run as balance evidence.",
    };
  }
  const uncovered = uncoveredEntries(manifest);
  if (uncovered.length === 0) {
    return {
      status: "good",
      title: `Actor coverage: ${manifest.entries.length}/${manifest.entries.length} mechanics covered (${manifest.mode})`,
      detail: "Every known actor-gated mechanic resolved through its representative path.",
    };
  }
  return {
    status: "warn",
    title: `Actor coverage: ${uncovered.length} mechanic(s) partial or unreachable (${manifest.mode})`,
    detail: uncovered.map((e) => `${e.label}: ${e.status} — ${e.reason}`).join(" "),
  };
}
