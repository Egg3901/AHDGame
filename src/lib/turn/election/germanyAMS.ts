/**
 * German AMS (Mixed-Member Proportional) election orchestrator — aggregate-native.
 *
 * The whole game persists chamber seats as AGGREGATE `electedOfficials` docs:
 * one doc per (party, region) with a `seatsHeld` count and a single
 * representative `characterId`. The Bundestag direct tier (Wahlkreis mandates)
 * uses this same model. This orchestrator therefore reads/writes seats as
 * aggregate counts, not one-official-per-seat.
 *
 * Phases:
 * 1. Read direct mandates (aggregate seatsHeld per party / per Land)
 * 2. Derive Zweitstimmen from Erststimmen via ticket-split crossover
 * 3. Federal Sainte-Laguë allocation (era-sized chamber — 630 seats for a
 *    modern-default world, 487 for 1953 — via getLiveLowerChamberSeats;
 *    5% / 3-direct threshold)
 * 4. Per-Land list distribution; list = max(0, Land quota − direct seats)
 *    (overhang clamps to 0 — no per-Wahlkreis individual dropping)
 * 5. Persist aggregate list officials (one per party+Land, seatSource="list")
 *
 * Entry point: allocateBundestag(db, cycle) / maybeReconcileBundestag(db, cycle)
 * Runs once per cycle AFTER all 16 Land Bundestag elections are resolved.
 */

import type { Db, ObjectId as MongoObjectId } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Election,
  ElectedOfficial,
  ElectionVoteTally,
  Landesliste,
  Character,
  GameState,
} from "@/lib/db/types";
import { allocateViaSainteLague } from "./sainteLagueAllocation";
import {
  crossoverRatesForPreset,
  deriveZweitstimmen,
  type ErststimmeInput,
} from "./ticketSplitCrossover";
import { buildDEPartySlugToSeqId } from "@/lib/seeds/de/deStatePartyOrgCalculations";
import { getLiveLowerChamberSeats } from "@/lib/turn/lowerChamberSeats";

const VOTE_THRESHOLD = 0.05;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ZweitstimmenByLand {
  /** Total Zweitstimmen per party nationwide */
  national: Record<string, number>;
  /** Zweitstimmen per party per Land: { partyId: { landId: votes } } */
  perLand: Record<string, Record<string, number>>;
}

export interface FederalAllocation {
  /** Total Bundestag seats per party after 5%/3-direct threshold + Sainte-Laguë */
  partySeats: Record<string, number>;
  totalAllocated: number;
}

/**
 * A named seat-holder identity, denormalized onto the ElectedOfficial doc so the
 * members/composition APIs (which require `characterName`) count the seats.
 */
export interface RepIdentity {
  characterId: MongoObjectId | null;
  nppId: MongoObjectId | null;
  characterName: string;
  isNPP: boolean;
}

export interface DirectMandates {
  /** Total direct seats per party (sum of seatsHeld). */
  byParty: Record<string, number>;
  /** Direct seats per party per Land. */
  byPartyLand: Record<string, Record<string, number>>;
  /** A representative direct-seat characterId per (party, Land), for list dedupe. */
  repByPartyLand: Record<string, Record<string, MongoObjectId | null>>;
  /**
   * A valid named holder identity per party, taken from its direct mandates
   * (prefers an NPP-backed seat — the game's aggregate-placeholder convention).
   * Used as the fallback list-seat holder when a party has no resident member in
   * a Land, so every list bloc still carries a `characterName` and counts.
   */
  partyRep: Record<string, RepIdentity>;
  totalDirect: number;
}

export interface LandListAllocation {
  partyId: string;
  landId: string;
  /** Direct seats this party holds in this Land (aggregate seatsHeld). */
  directSeats: number;
  /** Sainte-Laguë Land quota for this party before subtracting direct seats. */
  listQuotaRaw: number;
  /** List seats to fill = max(0, listQuotaRaw − directSeats). Overhang clamps to 0. */
  listSeatsAwarded: number;
}

export type ListOfficialDraft = Omit<ElectedOfficial, "_id" | "createdAt" | "updatedAt">;

export interface BundestagElectionResult {
  cycle: number;
  direct: DirectMandates;
  zweitstimmen: ZweitstimmenByLand;
  federalAllocation: FederalAllocation;
  landAllocations: LandListAllocation[];
  listOfficials: ListOfficialDraft[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the Bundestag list-seat composition for a cycle. Does NOT write —
 * returns a plan; `persistBundestagResult` writes the list officials.
 */
export async function allocateBundestag(db: Db, cycle: number): Promise<BundestagElectionResult> {
  // ─── Phase 1: Direct mandates (aggregate seatsHeld) ───────────────────────
  const direct = await fetchDirectMandates(db);

  // ─── Phase 2: Zweitstimmen (party-level, per Land) ────────────────────────
  const zweitstimmen = await computeZweitstimmen(db, cycle);

  // ─── Phase 3: Federal Sainte-Laguë allocation (5% / 3-direct threshold) ───
  // Chamber size is era-aware: `getLiveLowerChamberSeats` reads the world's
  // `gameState.preset` and returns that era's configured Bundestag size (487
  // for 1953-default, 630 for a modern-default world / no preset). A prior
  // version hardcoded 630 here regardless of era, which over-seated a 1953
  // Bundestag by 51% — 630 held against a 251-seat direct-mandate founding
  // cycle instead of the era's true 487 (issue #3896).
  const bundestagSeats = await getLiveLowerChamberSeats(db, "DE");
  const federalAllocation = allocateViaSainteLague(
    Object.entries(zweitstimmen.national).map(([partyId, votes]) => ({ partyId, votes })),
    bundestagSeats,
    { minVoteShare: VOTE_THRESHOLD, minDirectMandates: direct.byParty }
  );

  // ─── Phase 4: Per-Land list distribution (overhang clamps to 0) ───────────
  const landAllocations = allocateListSeatsPerLand(federalAllocation, direct, zweitstimmen);

  // ─── Phase 5: Build candidate map + assign aggregate list officials ───────
  const candidatesByPartyLand = await buildCandidateMap(db, cycle, landAllocations);
  const directReps = new Map<string, MongoObjectId | null>();
  for (const [party, lands] of Object.entries(direct.repByPartyLand)) {
    for (const [land, rep] of Object.entries(lands)) {
      directReps.set(`${party}:${land}`, rep);
    }
  }
  const listOfficials = assignListSeats(
    landAllocations,
    candidatesByPartyLand,
    directReps,
    direct.partyRep
  );

  return { cycle, direct, zweitstimmen, federalAllocation, landAllocations, listOfficials };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Direct mandates (aggregate)
// ─────────────────────────────────────────────────────────────────────────────

/** Pure aggregation of direct-mandate officials into per-party / per-Land seat counts. */
export function aggregateDirectMandates(officials: ElectedOfficial[]): DirectMandates {
  const byParty: Record<string, number> = {};
  const byPartyLand: Record<string, Record<string, number>> = {};
  const repByPartyLand: Record<string, Record<string, MongoObjectId | null>> = {};
  const partyRep: Record<string, RepIdentity> = {};
  let totalDirect = 0;

  for (const o of officials) {
    const party = o.party;
    const land = o.state;
    const seats = o.seatsHeld ?? 0;
    if (!party || !land || seats <= 0) continue;

    byParty[party] = (byParty[party] ?? 0) + seats;
    byPartyLand[party] ??= {};
    byPartyLand[party][land] = (byPartyLand[party][land] ?? 0) + seats;
    repByPartyLand[party] ??= {};
    if (repByPartyLand[party][land] == null && o.characterId) {
      repByPartyLand[party][land] = o.characterId;
    }

    // Build a per-party fallback holder identity. Only consider docs that carry a
    // usable characterName (the members API requires it). Prefer NPP-backed seats
    // so the reused identity is an aggregate placeholder, not a real player who
    // would then appear to hold seats in two regions.
    const isNPP = o.isNPP ?? !o.characterId;
    if (o.characterName && o.characterName !== "Unknown") {
      const existing = partyRep[party];
      if (!existing || (!existing.isNPP && isNPP)) {
        partyRep[party] = {
          characterId: o.characterId ?? null,
          nppId: o.nppId ?? null,
          characterName: o.characterName,
          isNPP,
        };
      }
    }

    totalDirect += seats;
  }

  return { byParty, byPartyLand, repByPartyLand, partyRep, totalDirect };
}

/** Read DE Bundestag direct-mandate officials (seatSource direct or absent) and aggregate. */
export async function fetchDirectMandates(db: Db): Promise<DirectMandates> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      countryId: "DE",
      officeType: "bundestag",
      $or: [{ seatSource: "direct" }, { seatSource: { $exists: false } }],
    })
    .toArray();
  return aggregateDirectMandates(officials);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Zweitstimmen aggregation (party totals, derived via ticket-split)
// ─────────────────────────────────────────────────────────────────────────────

export async function computeZweitstimmen(db: Db, cycle: number): Promise<ZweitstimmenByLand> {
  // Fetch all Bundestag elections and their tallies for this cycle.
  const elections = await db
    .collection<Election>("elections")
    .find({
      countryId: "DE",
      electionType: { $in: ["bundestag", "snap_bundestag"] },
      cycle,
    })
    .toArray();

  if (elections.length === 0) {
    return { national: {}, perLand: {} };
  }

  const electionById = new Map(elections.map((e) => [e._id.toString(), e]));
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find({ electionId: { $in: elections.map((e) => e._id) } })
    .toArray();

  // Aggregate Erststimmen per party per Land (state).
  const erstByLandByParty: Record<string, Record<string, number>> = {};
  for (const tally of tallies) {
    const election = electionById.get(tally.electionId.toString());
    if (!election?.state) continue;
    const landId = election.state;

    for (const [candidateKey, votes] of Object.entries(tally.totalVotes)) {
      const partyId = tally.candidateParties[candidateKey];
      if (!partyId) continue;
      erstByLandByParty[landId] ??= {};
      erstByLandByParty[landId][partyId] = (erstByLandByParty[landId][partyId] ?? 0) + votes;
    }
  }

  // Derive per-Land Zweitstimmen via ticket-split crossover.
  //
  // The rate table is slug-keyed and era-scoped, so it is resolved against the
  // live party roster once per cycle (#810). `buildDEPartySlugToSeqId` only
  // returns parties that exist under the active preset, so a rule naming a
  // party this world does not have is dropped rather than inventing votes.
  const [slugToPartyId, gameState] = await Promise.all([
    buildDEPartySlugToSeqId(db),
    db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } }),
  ]);
  const rates = crossoverRatesForPreset(gameState?.preset);

  const zweiPerLand: Record<string, Record<string, number>> = {};
  for (const [landId, partyErst] of Object.entries(erstByLandByParty)) {
    const input: ErststimmeInput[] = Object.entries(partyErst).map(([partyId, votes]) => ({
      partyId,
      votes,
    }));
    const derived = deriveZweitstimmen(input, rates, slugToPartyId);
    for (const { partyId, votes } of derived) {
      zweiPerLand[partyId] ??= {};
      zweiPerLand[partyId][landId] = (zweiPerLand[partyId][landId] ?? 0) + votes;
    }
  }

  // National totals = sum per party across Länder.
  const national: Record<string, number> = {};
  for (const [partyId, byLand] of Object.entries(zweiPerLand)) {
    national[partyId] = Object.values(byLand).reduce((s, v) => s + v, 0);
  }

  return { national, perLand: zweiPerLand };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Per-Land list distribution (overhang clamps to 0)
// ─────────────────────────────────────────────────────────────────────────────

export function allocateListSeatsPerLand(
  federal: FederalAllocation,
  direct: DirectMandates,
  zweitstimmen: ZweitstimmenByLand
): LandListAllocation[] {
  const results: LandListAllocation[] = [];

  for (const [partyId, totalFederalSeats] of Object.entries(federal.partySeats)) {
    const partyLandVotes = zweitstimmen.perLand[partyId] ?? {};
    const landEntries = Object.entries(partyLandVotes);
    if (landEntries.length === 0 || totalFederalSeats === 0) continue;

    // Distribute this party's federal seats across Länder by per-Land Zweitstimmen.
    const landQuota = allocateViaSainteLague(
      landEntries.map(([landId, votes]) => ({ partyId: landId, votes })),
      totalFederalSeats,
      { minVoteShare: 0 } // No threshold at the Land sub-distribution level
    );

    for (const [landId, quota] of Object.entries(landQuota.partySeats)) {
      const directSeats = direct.byPartyLand[partyId]?.[landId] ?? 0;
      const listSeatsAwarded = Math.max(0, quota - directSeats);
      results.push({ partyId, landId, directSeats, listQuotaRaw: quota, listSeatsAwarded });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: Aggregate list-seat officials
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For each (party, Land) that won list seats, return ordered resident-player
 * holder identities: the Landesliste candidates if present, else party members
 * resident in the Land ranked by nationalInfluence. Names are resolved so the
 * resulting officials carry a `characterName` (required by the members API).
 */
async function buildCandidateMap(
  db: Db,
  cycle: number,
  allocations: LandListAllocation[]
): Promise<Map<string, RepIdentity[]>> {
  const map = new Map<string, RepIdentity[]>();
  const lists = await db
    .collection<Landesliste>("landeslisten")
    .find({ countryId: "DE", cycle })
    .toArray();
  const listByKey = new Map(lists.map((l) => [`${l.partyId}:${l.landId}`, l]));

  // First pass: determine the ordered candidate ObjectIds per bloc.
  const idsByKey = new Map<string, MongoObjectId[]>();
  const allIds: MongoObjectId[] = [];
  for (const a of allocations) {
    if (a.listSeatsAwarded <= 0) continue;
    const key = `${a.partyId}:${a.landId}`;
    const list = listByKey.get(key);
    let ids: MongoObjectId[];
    if (list && list.candidates.length > 0) {
      ids = list.candidates;
    } else {
      const members = await db
        .collection<Character>("characters")
        .find(
          { countryId: "DE", party: a.partyId, homeState: a.landId },
          { projection: { _id: 1, nationalInfluence: 1 } }
        )
        .toArray();
      ids = members
        .slice()
        .sort((x, y) => {
          const xn = x.nationalInfluence ?? 0;
          const yn = y.nationalInfluence ?? 0;
          if (yn !== xn) return yn - xn;
          return x._id.toString().localeCompare(y._id.toString());
        })
        .map((m) => m._id);
    }
    idsByKey.set(key, ids);
    allIds.push(...ids);
  }

  // Resolve names for every referenced candidate in one batch.
  const nameById = new Map<string, string>();
  if (allIds.length > 0) {
    const chars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: allIds } }, { projection: { _id: 1, name: 1 } })
      .toArray();
    for (const c of chars) {
      if (c.name) nameById.set(c._id.toString(), c.name);
    }
  }

  for (const [key, ids] of idsByKey.entries()) {
    const reps: RepIdentity[] = [];
    for (const id of ids) {
      const name = nameById.get(id.toString());
      if (!name) continue; // skip members we can't name
      reps.push({ characterId: id, nppId: null, characterName: name, isNPP: false });
    }
    map.set(key, reps);
  }
  return map;
}

/**
 * Build aggregate list-seat officials: one doc per (party, Land) with
 * seatsHeld = list seats won and a named representative. Prefers a resident
 * party member who is not already the direct-tier rep; falls back to the party's
 * representative identity so every bloc carries a `characterName` and counts.
 */
export function assignListSeats(
  allocations: LandListAllocation[],
  candidatesByPartyLand: Map<string, RepIdentity[]>,
  directReps: Map<string, MongoObjectId | null>,
  partyRep: Record<string, RepIdentity>
): ListOfficialDraft[] {
  const drafts: ListOfficialDraft[] = [];

  for (const a of allocations) {
    if (a.listSeatsAwarded <= 0) continue;
    const key = `${a.partyId}:${a.landId}`;
    const candidates = candidatesByPartyLand.get(key) ?? [];
    const directRep = directReps.get(key) ?? null;

    const preferred = candidates.find(
      (c) => !(directRep && c.characterId && c.characterId.equals(directRep))
    );
    const rep: RepIdentity | null = preferred ?? candidates[0] ?? partyRep[a.partyId] ?? null;

    drafts.push({
      countryId: "DE",
      officeType: "bundestag",
      state: a.landId,
      party: a.partyId,
      seatsHeld: a.listSeatsAwarded,
      seatSource: "list",
      characterId: rep?.characterId ?? null,
      nppId: rep?.nppId ?? undefined,
      characterName: rep?.characterName,
      isNPP: rep?.isNPP ?? false,
      isAppointment: false,
      electedAt: new Date(),
    });
  }

  return drafts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence + per-cycle reconciliation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persists the list-seat composition. Idempotent: clears any prior DE Bundestag
 * list officials before inserting fresh ones, so re-running a cycle replaces
 * cleanly. Direct-tier officials are untouched.
 *
 * Concurrency safety: `deleteMany` + `insertMany` is not atomic, so two overlapping
 * reconciliation runs (e.g. a non-atomic turn retry — see #2815) could both delete,
 * then both insert, doubling every (party, Land) list bloc and inflating the chamber
 * (observed in prod: 963/630, ticket #929 / issue #2957). The partial unique index
 * on `{countryId, officeType, state, party}` for `seatSource:"list"` (created by
 * scripts/heal-de-bundestag-dup-list.ts) makes the second insert of a duplicate key
 * fail; we insert unordered and swallow the E11000 so the losing racer converges to
 * the same single set instead of crashing the turn or doubling seats.
 */
export async function persistBundestagResult(
  db: Db,
  result: BundestagElectionResult,
  now: Date = new Date()
): Promise<void> {
  await db.collection<ElectedOfficial>("electedOfficials").deleteMany({
    countryId: "DE",
    officeType: "bundestag",
    seatSource: "list",
  });

  if (result.listOfficials.length > 0) {
    const docs = result.listOfficials.map((o) => ({
      ...o,
      _id: new ObjectId(),
      createdAt: now,
      updatedAt: now,
    }));
    try {
      await db.collection<ElectedOfficial>("electedOfficials").insertMany(docs, { ordered: false });
    } catch (err) {
      // E11000 = duplicate key: a concurrent run already inserted this bloc set.
      // Any non-duplicate error is real and must propagate.
      if (!isDuplicateKeyError(err)) throw err;
    }
  }
}

/** True for a Mongo duplicate-key error (code 11000), incl. bulk-write wrappers. */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: number; writeErrors?: Array<{ code?: number }> };
  if (e.code === 11000) return true;
  if (Array.isArray(e.writeErrors)) return e.writeErrors.every((w) => w.code === 11000);
  return false;
}

/**
 * Runs AMS list-seat reconciliation iff (a) every DE Bundestag constituency for
 * this cycle has resolved, and (b) this cycle has not already been reconciled
 * (`gameState.lastBundestagReconciledCycle`). Safe to call after every
 * individual constituency resolution — returns null until the final one
 * completes, then exactly once per cycle.
 */
export async function maybeReconcileBundestag(
  db: Db,
  cycle: number,
  now: Date = new Date()
): Promise<BundestagElectionResult | null> {
  const pending = await db.collection<Election>("elections").countDocuments({
    countryId: "DE",
    electionType: { $in: ["bundestag", "snap_bundestag"] },
    cycle,
    status: { $nin: ["resolved", "cancelled"] },
  });
  if (pending > 0) return null;

  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const lastReconciled = gs?.lastBundestagReconciledCycle ?? -1;
  if (lastReconciled >= cycle) return null;

  const result = await allocateBundestag(db, cycle);
  await persistBundestagResult(db, result, now);
  await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current" },
      { $set: { lastBundestagReconciledCycle: cycle, updatedAt: now } }
    );
  return result;
}
