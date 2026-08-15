import type { PlantIdleCauseKey } from "../types";
import type { CorporationType } from "@/lib/constants/corporations";
import { facilityVocabulary } from "@/lib/constants/facilityVocabulary";

/**
 * Shared vocabulary for the plants-tier panels.
 *
 * COPY RULE (project standing): player-facing strings here are plain language.
 * No em dashes, no en dashes, no jargon, short sentences.
 */

/** Format a unit count for display. Capacity is fractional but reads as whole. */
export function fmtUnits(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

/** Format a 0–1 share as a whole percent. */
export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/** Format a multiplier leg for the cost breakdown, e.g. "1.12x". */
export function fmtMult(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "1.00x";
  return `${n.toFixed(2)}x`;
}

export interface IdleCauseMeta {
  label: string;
  /** Semantic token slice used for the meter segment and legend dot. */
  tone: "warning" | "error" | "muted" | "info";
  help: string;
}

/**
 * Idle-cause copy, in the sector's own words.
 *
 * The engine names one set of causes for every sector type, but the sentence
 * that explains a cause has to name the thing that stopped. A retail sector
 * that runs out of stock did not stop "the line", it stopped "the floor", and
 * it did not do it in a plant. `facilityVocabulary` supplies both nouns, so
 * this stays one source of copy instead of seventeen.
 */
export function idleCauseMeta(
  sectorType: CorporationType | string | null | undefined
): Record<PlantIdleCauseKey, IdleCauseMeta> {
  const v = facilityVocabulary(sectorType);
  const sites = v.plural;
  const run = v.runNoun;
  return {
    inputs: {
      label: "Waiting on inputs",
      tone: "warning",
      help: `Your ${sites} could not buy enough of what they consume, so part of ${run} stopped. Check the Inputs list below for the item in short supply.`,
    },
    strike: {
      label: "Strike",
      tone: "error",
      help: `Your workers are on strike. Most of ${run} is stopped until the strike ends.`,
    },
    disaster: {
      label: "Damage and disruption",
      tone: "error",
      help: `A live crisis in this region is stopping part of ${run}. It fades as the crisis decays.`,
    },
    policy: {
      label: "Held back on purpose",
      tone: "info",
      help: "You set output below full. Raise the output target to run more of your capacity.",
    },
    deposits: {
      label: "Deposits ran short",
      tone: "warning",
      help: "This region does not hold enough of the resource to feed all your capacity. Build in a region with more left in the ground.",
    },
    mothballed: {
      label: "Mothballed",
      tone: "muted",
      help: `You put these ${sites} into cold storage. They make nothing and pay reduced upkeep until you turn them back on.`,
    },
    other: {
      label: "Other limits",
      tone: "muted",
      help: "Capacity that did not run for reasons the engine did not name this turn, for example a spare run rate or a rounding gap.",
    },
  };
}

/** Tailwind classes per tone, for meter fills and legend dots. */
export const TONE_FILL: Record<IdleCauseMeta["tone"] | "sold" | "unsold", string> = {
  sold: "bg-success",
  unsold: "bg-warning",
  warning: "bg-warning/50",
  error: "bg-error/60",
  info: "bg-info/50",
  muted: "bg-muted/40",
};

/**
 * One clock, said once. Money in this game is stored per financial day, and one
 * game year is two financial days.
 */
export const PLANTS_CLOCK_NOTE =
  "Totals cover one financial day (24 turns). Per-unit figures are averages across the same day's output. One game year is 48 turns.";
