import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  CountryLeaderState,
  LeaderConfidenceHistoryEntry,
} from "@/lib/db/types/countryLeaderState";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import type { Db } from "mongodb";
import {
  INITIAL_CONFIDENCE,
  RENEWAL_BUMP,
  REUNIFICATION_BUMP,
  MAX_HISTORY_ENTRIES,
  clampConfidence,
} from "@/lib/onePartyState/rulingPartyConfidence";

// Pure surface (constants, bands, clamp/bump helpers) lives in the domain
// layer; re-exported here so existing importers keep working.
export * from "@/lib/onePartyState/rulingPartyConfidence";

/**
 * Resolve the renewal bump for a specific country, honouring the
 * persistent `renewalBumpOverride` set by the Phase-5
 * constitutional-amendment reform action. Falls back to the default
 * `RENEWAL_BUMP` (+5) when no override exists or when the country has
 * no countryState row.
 *
 * Wrapped in try/catch so callers in MockDb-shaped tests that don't
 * stub countryState still get the default rather than a thrown error
 * — symmetrical with the rest of the countryState read paths.
 */
export async function resolveRenewalBumpForCountry(db: Db, countryId: CountryId): Promise<number> {
  try {
    const { getCountryState } = await import("@/lib/countryState");
    const state = await getCountryState(db, countryId);
    return state.renewalBumpOverride ?? RENEWAL_BUMP;
  } catch {
    return RENEWAL_BUMP;
  }
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
  if (history.length <= MAX_HISTORY_ENTRIES) return history;
  return history.slice(0, MAX_HISTORY_ENTRIES);
}

// ── Persistence helpers ──────────────────────────────────────────────────────

function buildId(countryId: CountryId, leaderCharacterId: ObjectId): string {
  return `${countryId}_${leaderCharacterId.toString()}`;
}

/**
 * Install a new leader with fresh confidence (75).
 * Overwrites any existing state for this leader.
 */
export async function installNewLeader(
  db: Db,
  countryId: CountryId,
  leaderCharacterId: ObjectId,
  leaderOfficeType: string,
  governingPartyId: string | null,
  currentTurn: number
): Promise<CountryLeaderState> {
  const coll = getCountryLeaderStatesCollection(db);
  const now = new Date();
  const _id = buildId(countryId, leaderCharacterId);

  const state: CountryLeaderState = {
    _id,
    countryId,
    leaderCharacterId,
    leaderOfficeType,
    governingPartyId,
    partyConfidence: INITIAL_CONFIDENCE,
    startedAtTurn: currentTurn,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    createdAt: now,
    updatedAt: now,
  };

  await coll.replaceOne({ _id }, state, { upsert: true });
  return state;
}

/**
 * Renew the current leader's mandate.
 * - If leader changed since last record: re-install as new leader (reset to 75).
 * - If same leader: bump by +5, cap at 95, increment renewalCount.
 * - Idempotent: if already renewed this turn, no-op.
 */
export async function renewLeaderMandate(
  db: Db,
  countryId: CountryId,
  leaderCharacterId: ObjectId,
  leaderOfficeType: string,
  governingPartyId: string | null,
  currentTurn: number
): Promise<{ state: CountryLeaderState; bumped: boolean }> {
  const coll = getCountryLeaderStatesCollection(db);
  const _id = buildId(countryId, leaderCharacterId);

  const existing = await coll.findOne({ _id });

  // If no prior state, or leader changed: treat as new install
  if (!existing || !existing.leaderCharacterId.equals(leaderCharacterId)) {
    const state = await installNewLeader(
      db,
      countryId,
      leaderCharacterId,
      leaderOfficeType,
      governingPartyId,
      currentTurn
    );
    return { state, bumped: false };
  }

  // Idempotency: already renewed this turn
  if (existing.lastRenewedAtTurn === currentTurn) {
    return { state: existing, bumped: false };
  }

  const bump = await resolveRenewalBumpForCountry(db, countryId);
  const newConfidence = clampConfidence(existing.partyConfidence + bump);
  const entry = makeHistoryEntry(
    currentTurn,
    existing.partyConfidence,
    newConfidence,
    "Leadership mandate renewed"
  );
  const newHistory = trimHistory([entry, ...existing.confidenceHistory]);

  const update = {
    $set: {
      leaderOfficeType,
      governingPartyId,
      partyConfidence: newConfidence,
      lastRenewedAtTurn: currentTurn,
      updatedAt: new Date(),
      confidenceHistory: newHistory,
    },
    $inc: { renewalCount: 1 },
  };

  const result = await coll.findOneAndUpdate({ _id }, update, { returnDocument: "after" });
  if (!result) {
    // Fallback if findOneAndUpdate fails
    const state = await installNewLeader(
      db,
      countryId,
      leaderCharacterId,
      leaderOfficeType,
      governingPartyId,
      currentTurn
    );
    return { state, bumped: false };
  }

  return { state: result, bumped: true };
}

/**
 * Move a leader's confidence record onto the country that absorbed theirs.
 *
 * A merge carries the head of government (`governmentFormations.pmCharacterId`)
 * but the confidence record is keyed `${countryId}_${characterId}`, so it does
 * not follow: the leader arrived in the surviving state with no mandate on
 * record and `installNewLeader` would later reset them to 75 as though they had
 * just taken office. The record is REWRITTEN under the survivor rather than
 * updated, because the country id is half the primary key.
 *
 * `startedAtTurn` and `renewalCount` are preserved — the leader's tenure did not
 * restart, their state grew — and the carry adds `REUNIFICATION_BUMP` on top,
 * clamped to `MAX_CONFIDENCE` like every other bump.
 *
 * IDEMPOTENT on the survivor's row: a second run finds it already there and
 * neither re-bumps nor rewrites history. The absorbed row is deleted either way,
 * so a re-run after a partial failure still finishes the move.
 *
 * Returns null when there is nothing to carry — an NPP head of government holds
 * no character-keyed record, and neither does a leader who never had a mandate
 * installed.
 */
export async function carryLeaderStateOnMerge(
  db: Db,
  params: {
    fromCountryId: CountryId;
    toCountryId: CountryId;
    leaderCharacterId: ObjectId;
    /** The office key the leader holds in the SURVIVING country. */
    leaderOfficeType: string;
    /** The ruling party under its post-migration number, or null. */
    governingPartyId: string | null;
    currentTurn: number;
  }
): Promise<CountryLeaderState | null> {
  const {
    fromCountryId,
    toCountryId,
    leaderCharacterId,
    leaderOfficeType,
    governingPartyId,
    currentTurn,
  } = params;
  const coll = getCountryLeaderStatesCollection(db);
  const fromId = buildId(fromCountryId, leaderCharacterId);
  const toId = buildId(toCountryId, leaderCharacterId);

  const existingSurvivor = await coll.findOne({ _id: toId });
  if (existingSurvivor) {
    // Already carried. Still clear the absorbed row so the dissolved country
    // stops carrying a leader.
    await coll.deleteOne({ _id: fromId });
    return existingSurvivor;
  }

  const absorbed = await coll.findOne({ _id: fromId });
  if (!absorbed) return null;

  const nextConfidence = clampConfidence(absorbed.partyConfidence + REUNIFICATION_BUMP);
  const entry = makeHistoryEntry(
    currentTurn,
    absorbed.partyConfidence,
    nextConfidence,
    "Confidence carried across reunification"
  );

  const carried: CountryLeaderState = {
    ...absorbed,
    _id: toId,
    countryId: toCountryId,
    leaderOfficeType,
    governingPartyId,
    partyConfidence: nextConfidence,
    confidenceHistory: trimHistory([entry, ...absorbed.confidenceHistory]),
    updatedAt: new Date(),
  };

  await coll.replaceOne({ _id: toId }, carried, { upsert: true });
  await coll.deleteOne({ _id: fromId });
  return carried;
}

/**
 * Self-heal: if no leader-state row exists for this country + character,
 * create a minimal one with INITIAL scalars. Used by adjustLeaderConfidence
 * and adjustPopularLegitimacy so admin-formed leaders (who never went
 * through `installNewLeader`) still pick up reform / decision / convention
 * scalar updates instead of silently no-opping.
 *
 * Leader-metadata fields that aren't known here (leaderOfficeType,
 * governingPartyId from the runtime side) are filled with safe defaults —
 * the next `installNewLeader` call (e.g. via Stage-3 concedeLeadership)
 * upserts the full shape.
 */
export async function ensureLeaderStateExists(
  db: Db,
  countryId: CountryId,
  leaderCharacterId: ObjectId,
  currentTurn: number
): Promise<CountryLeaderState> {
  const coll = getCountryLeaderStatesCollection(db);
  const _id = buildId(countryId, leaderCharacterId);
  const existing = await coll.findOne({ _id });
  if (existing) return existing;

  // Resolve governingPartyId from the runtime so the leader-API's
  // `{countryId, governingPartyId}` lookup can find this row after the
  // self-heal. Without it, every reform action would apply scalar
  // deltas to a row the API can't find — the diagnostic surface
  // would silently keep showing INITIAL defaults despite the writes
  // landing successfully.
  let governingPartyId: string | null = null;
  try {
    const { getCountryState } = await import("@/lib/countryState");
    const runtime = await getCountryState(db, countryId);
    if (runtime.rulingPartyId !== null) {
      governingPartyId = String(runtime.rulingPartyId);
    }
  } catch {
    /* keep null — degenerate case, scalars still update but API may not see them */
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
    createdAt: now,
    updatedAt: now,
  };
  try {
    await coll.insertOne(seed);
  } catch {
    /* concurrent insert race — re-read and return */
  }
  const after = await coll.findOne({ _id });
  return after ?? seed;
}

/**
 * Adjust a leader's confidence by a delta.
 * Used by Phase 07 (purges, policy alignment, etc.).
 */
export async function adjustLeaderConfidence(
  db: Db,
  countryId: CountryId,
  leaderCharacterId: ObjectId,
  delta: number,
  reason: string,
  currentTurn: number
): Promise<CountryLeaderState | null> {
  const coll = getCountryLeaderStatesCollection(db);
  const _id = buildId(countryId, leaderCharacterId);

  // Self-heal missing leader-state row (admin-formed governments, fresh
  // games before the per-turn driver has run for this country).
  const existing = await ensureLeaderStateExists(db, countryId, leaderCharacterId, currentTurn);
  if (!existing) return null;

  const newConfidence = clampConfidence(existing.partyConfidence + delta);
  const entry = makeHistoryEntry(currentTurn, existing.partyConfidence, newConfidence, reason);
  const newHistory = trimHistory([entry, ...existing.confidenceHistory]);

  const result = await coll.findOneAndUpdate(
    { _id },
    {
      $set: {
        partyConfidence: newConfidence,
        confidenceHistory: newHistory,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  );

  return result;
}
