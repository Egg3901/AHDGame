/**
 * Crash-resume results for phases whose output a later phase consumes (#3429).
 *
 * A resumed turn skips every phase the dead holder already applied, so those
 * phases return nothing. That is only safe for a phase nobody downstream reads.
 * `bondTurn` is not one: V2 treasury cash settles from its actual sovereign
 * flows. A phase listed here persists a bounded, typed copy of its result in the
 * same gameState write that records it completed, and the resume path hands
 * that copy back instead of rerunning committed writes.
 *
 * Plain data only: no database, clock or environment. The runtime shell owns
 * the writes.
 */
import type { BondTurnResult } from "@/lib/turn/bondTurn";
import type { TurnPhaseTelemetryMap } from "@/lib/db/types";

/** Country-keyed maps stay far below this; anything larger is not a bond flow. */
const MAX_FLOW_KEYS = 256;
const MAX_KEY_LENGTH = 64;

const BOND_COUNTS = [
  "bondsProcessed",
  "couponsPaid",
  "bondsMatured",
  "bondsDefaulted",
  "totalCouponsPaid",
  "bondHistorySnapshots",
  "bondsAutoRestructured",
  "bondsAutoRefinanced",
] as const;

const BOND_FLOWS = [
  "sovereignCashProceedsByCountry",
  "sovereignDebtFaceIssuedByCountry",
  "sovereignCouponPaidByCountry",
  "sovereignMaturityCashPaidByCountry",
  "sovereignDebtFaceRetiredByCountry",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedFlow(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_FLOW_KEYS) return null;
  const out: Record<string, number> = {};
  for (const [key, amount] of entries) {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
    if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
    out[key] = amount;
  }
  return out;
}

/** Narrow a fresh or persisted value to an exact BondTurnResult, or null. */
function decodeBondTurnResult(raw: unknown): BondTurnResult | null {
  if (!isRecord(raw)) return null;
  const out: Partial<BondTurnResult> = {};
  for (const key of BOND_COUNTS) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    out[key] = value;
  }
  for (const key of BOND_FLOWS) {
    if (raw[key] === undefined) continue;
    const flow = boundedFlow(raw[key]);
    if (!flow) return null;
    out[key] = flow;
  }
  return out as BondTurnResult;
}

interface ResumeResultCodec {
  /** Bounded persistable copy of a fresh result; null when it cannot be kept. */
  encode(result: unknown): Record<string, unknown> | null;
  /** Exact restored result, or null when the stored copy is missing or malformed. */
  decode(raw: unknown): unknown;
}

const CODECS: Record<string, ResumeResultCodec> = {
  bondTurn: { encode: decodeBondTurnResult, decode: decodeBondTurnResult },
};

export function phaseRequiresResumeResult(name: string): boolean {
  return Object.hasOwn(CODECS, name);
}

export function encodeResumeResult(name: string, result: unknown): Record<string, unknown> | null {
  return CODECS[name]?.encode(result) ?? null;
}

/**
 * How a dead holder left each phase. `completed` phases committed in full;
 * `interrupted` ones were mid-flight and may have committed part of their writes.
 * Neither may run again. Only a completed phase with a valid stored result can
 * hand that result to a dependent phase.
 */
export interface CrashedTurnPhaseState {
  completed: Set<string>;
  interrupted: Set<string>;
  results: Record<string, unknown>;
}

export function readCrashedTurnPhaseState(
  statuses: TurnPhaseTelemetryMap | null | undefined,
  rawResults: unknown
): CrashedTurnPhaseState {
  const completed = new Set<string>();
  const interrupted = new Set<string>();
  for (const [phase, telemetry] of Object.entries(statuses ?? {})) {
    // A resumed holder records the phases it inherited as skipped and carries
    // the inherited state forward, so a second crash still sees them applied.
    const state =
      telemetry?.status === "skipped" ? telemetry.resumeCarried : (telemetry?.status ?? null);
    if (state === "completed") completed.add(phase);
    else if (state === "running" || state === "interrupted") interrupted.add(phase);
  }
  const results: Record<string, unknown> = {};
  const stored = isRecord(rawResults) ? rawResults : {};
  for (const phase of completed) {
    if (!phaseRequiresResumeResult(phase)) continue;
    const decoded = CODECS[phase]!.decode(stored[phase]);
    if (decoded !== null) results[phase] = decoded;
  }
  return { completed, interrupted, results };
}

export type ResumeResultOutcome = "restored" | "missing" | "interrupted";

export class TurnResumeResultUnavailableError extends Error {
  constructor(
    readonly phase: string,
    readonly outcome: Exclude<ResumeResultOutcome, "restored">,
    readonly dependent: string
  ) {
    super(
      outcome === "interrupted"
        ? `Crash resume cannot run ${dependent}: ${phase} was interrupted mid-phase, so its ` +
            `committed flows are unknown. It will not be rerun. Repair required before this turn can finish.`
        : `Crash resume cannot run ${dependent}: ${phase} completed before the crash but no ` +
            `valid stored result exists. It will not be rerun and no zero flow is assumed. ` +
            `Repair required before this turn can finish.`
    );
    this.name = "TurnResumeResultUnavailableError";
  }
}
