/**
 * Popular legitimacy (public-mood) scalar for one-party states.
 *
 * Distinct from `partyConfidence` in `rulingPartyConfidence.ts` —
 * popular legitimacy measures public mood; party confidence measures
 * intra-party stability. They couple in one direction only: a popular
 * collapse bleeds into intra-party panic (see `rulingPartyPriorities.ts`
 * Phase 3 wiring); the reverse leak is small.
 *
 * Range 0–100. Initial 75. Slow-buildup tuning per the design doc:
 * normal per-turn drift bounded to ±2, with a +0.2/turn always-on drift
 * toward 60 (`POPULAR_RECOVERY_TARGET`) to prevent runaway death-spirals
 * and reward stability.
 *
 * Pure formulas + persistence helpers only. The per-turn aggregator
 * lives in `popularLegitimacyTurn.ts`; the individual driver functions
 * (economy, repression, policy, election credibility, intra-party
 * coupling, natural recovery) live in `popularLegitimacyDrivers.ts`.
 */
import type { ObjectId, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  CountryLeaderState,
  LeaderConfidenceHistoryEntry,
} from "@/lib/db/types/countryLeaderState";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import { INITIAL_CONFIDENCE } from "@/lib/turn/rulingPartyConfidence";

// ── Constants ──────────────────────────────────────────────────────────────

export const INITIAL_POPULAR_LEGITIMACY = 75;
export const MAX_POPULAR_LEGITIMACY = 100;
export const MIN_POPULAR_LEGITIMACY = 0;
export const MAX_POPULAR_HISTORY_ENTRIES = 50;

/** Always-on drift target; popular legitimacy regresses toward this value. */
export const POPULAR_RECOVERY_TARGET = 60;

/**
 * Per-turn rate of the natural-recovery drift (toward {@link POPULAR_RECOVERY_TARGET}).
 *
 * Halved from 0.2 → 0.1 on the request of player feedback that the
 * projected drift on a healthy 75 regime looked too steep (a 75 → 60
 * settling in ~75 turns reads as "collapse" instead of "regression to
 * mean"). At 0.1/turn the settling takes ~150 turns — still pulls the
 * regime back toward equilibrium, but on a timescale that matches the
 * design intent of "active leadership earns above-equilibrium scores."
 *
 * Side effects on the collapse path: with sustained bad governance,
 * natural recovery is a HEADWIND once popular falls below 60. Slowing
 * it weakens that headwind, so the regime sinks faster after the
 * trigger but stays above 60 longer beforehand. The collapse-path E2E
 * (Phase 8) is re-validated after this tuning change.
 */
export const POPULAR_RECOVERY_RATE = 0.1;

// ── Bands ──────────────────────────────────────────────────────────────────

/**
 * Public-mood bands surfaced to the UI. Players see the band label, not
 * the raw number; only ruling-party leadership sees the diagnostic value.
 */
export const POPULAR_BANDS = [
  { min: 75, label: "strong", description: "Strong public support" },
  { min: 36, label: "discontent", description: "Public discontent visible" },
  { min: 16, label: "crisis", description: "Crisis-level legitimacy" },
  { min: 0, label: "collapsing", description: "Regime legitimacy collapsing" },
] as const;

export type PopularBandLabel = (typeof POPULAR_BANDS)[number]["label"];

export function classifyPopularBand(value: number): PopularBandLabel {
  for (const band of POPULAR_BANDS) {
    if (value >= band.min) return band.label;
  }
  return "collapsing";
}

export function clampPopular(value: number): number {
  if (!Number.isFinite(value)) return MIN_POPULAR_LEGITIMACY;
  return Math.max(MIN_POPULAR_LEGITIMACY, Math.min(MAX_POPULAR_LEGITIMACY, value));
}

export function initializePopularLegitimacy(): number {
  return INITIAL_POPULAR_LEGITIMACY;
}

// ── History helpers ────────────────────────────────────────────────────────

function makeHistoryEntry(
  turn: number,
  previous: number,
  next: number,
  reason: string
): LeaderConfidenceHistoryEntry {
  return {
    turn,
    previous,
    next,
    delta: next - previous,
    reason,
    at: new Date(),
  };
}

function trimHistory(history: LeaderConfidenceHistoryEntry[]): LeaderConfidenceHistoryEntry[] {
  if (history.length <= MAX_POPULAR_HISTORY_ENTRIES) return history;
  return history.slice(0, MAX_POPULAR_HISTORY_ENTRIES);
}

// ── Persistence helpers ────────────────────────────────────────────────────

function buildId(countryId: CountryId, leaderCharacterId: ObjectId): string {
  return `${countryId}_${leaderCharacterId.toString()}`;
}

/**
 * Adjust a leader's popularLegitimacy by a delta. Writes a history entry.
 * Returns the updated state, or null if no leader-state doc exists yet
 * for the given country + leader.
 *
 * Treats a missing `popularLegitimacy` field on an existing doc as
 * {@link INITIAL_POPULAR_LEGITIMACY} (75) so leader-state rows created
 * before Phase 2 land continue to work without a backfill migration.
 */
export async function adjustPopularLegitimacy(
  db: Db,
  countryId: CountryId,
  leaderCharacterId: ObjectId,
  delta: number,
  reason: string,
  currentTurn: number
): Promise<CountryLeaderState | null> {
  const coll = getCountryLeaderStatesCollection(db);
  const _id = buildId(countryId, leaderCharacterId);

  // Self-heal missing leader-state (admin-formed governments / fresh
  // games before the per-turn driver has run). Mirrors the same
  // pattern in adjustLeaderConfidence so a reform / decision /
  // convention scalar update lands even when the row wasn't seeded by
  // installNewLeader. governingPartyId is resolved from the runtime
  // countryState so the leader-API's `{countryId, governingPartyId}`
  // lookup can find this row on the next read.
  let existing = await coll.findOne({ _id });
  if (!existing) {
    let governingPartyId: string | null = null;
    try {
      const { getCountryState } = await import("@/lib/countryState");
      const runtime = await getCountryState(db, countryId);
      if (runtime.rulingPartyId !== null) {
        governingPartyId = String(runtime.rulingPartyId);
      }
    } catch {
      /* keep null in degenerate case */
    }

    const now = new Date();
    const seed: CountryLeaderState = {
      _id,
      countryId,
      leaderCharacterId,
      leaderOfficeType: "",
      governingPartyId,
      partyConfidence: INITIAL_CONFIDENCE,
      startedAtTurn: currentTurn,
      lastRenewedAtTurn: null,
      renewalCount: 0,
      confidenceHistory: [],
      popularLegitimacy: INITIAL_POPULAR_LEGITIMACY,
      popularLegitimacyHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await coll.insertOne(seed);
    } catch {
      /* concurrent insert race — re-read */
    }
    existing = (await coll.findOne({ _id })) ?? seed;
  }

  const previous = existing.popularLegitimacy ?? INITIAL_POPULAR_LEGITIMACY;
  const next = clampPopular(previous + delta);
  const entry = makeHistoryEntry(currentTurn, previous, next, reason);
  const history = trimHistory([entry, ...(existing.popularLegitimacyHistory ?? [])]);

  const result = await coll.findOneAndUpdate(
    { _id },
    {
      $set: {
        popularLegitimacy: next,
        popularLegitimacyHistory: history,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  );

  return result;
}
