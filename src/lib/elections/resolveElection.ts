/**
 * resolveElection — Unified election data resolution service.
 *
 * Centralises all candidate fetching, enrichment, phase computation, polling,
 * seat estimation, and full-view tally logic that was previously duplicated
 * across the detail route (/api/elections/[id]) and the country list route
 * (/api/country/[code]/elections).
 *
 * Public entry points:
 *   resolveElection()   - single election (fetches its own data)
 *   resolveElections()  - batch (one round of queries, then _enrichElection)
 *   _enrichElection()   - low-level enrichment on pre-fetched data
 */

import type { Db, ObjectId as MongoObjectId } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  Character,
  NPP,
  PoliticalParty,
  GameState,
  NPPEndorsement,
  PlayerEndorsement,
  PrimarySnapshot,
  Campaign,
  StatePartyOrg,
  ElectionVoteTally,
} from "@/lib/db/types";
import { getGameTime } from "@/lib/time/gameTime";
import { isHexObjectIdString } from "@/lib/utils/objectIdHex";
import type {
  ElectionResponse,
  ResolveElectionOptions,
  ElectionDeps,
} from "./electionResponseTypes";
import { _enrichElection, fetchDepsForElection } from "./enrichElection";
import { buildActiveVisibleNppEndorsementFilter } from "@/lib/nppEndorsements";

export type {
  PollingData,
  SnapshotEntry,
  GeneralVotesData,
  GameStateData,
  ElectionResponse,
  ResolveElectionOptions,
  ElectionDeps,
} from "./electionResponseTypes";

export { computeSeatEstimates } from "./buildPollingData";
export { _enrichElection } from "./enrichElection";

// ---------------------------------------------------------------------------
// isSeatId helper (moved from detail route)
// ---------------------------------------------------------------------------

/**
 * Returns true when `id` looks like a seatId (e.g. "US-senate-PA-1")
 * rather than a 24-character ObjectId hex string.
 */
export function isSeatId(id: string): boolean {
  if (isHexObjectIdString(id)) return false;
  const parts = id.split("-");
  if (parts.length < 2) return false;
  // First segment must be a 2-letter country code
  if (!/^[A-Z]{2}$/i.test(parts[0])) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Resolves a single election by ObjectId, seatId, or pre-fetched document.
 *
 * @param db          - MongoDB Db instance
 * @param idOrElection - Election ObjectId string, seatId string, or pre-fetched Election doc
 * @param options      - { view, userId, isAdmin, cycle? }
 * @param cycle        - Optional cycle number (used when looking up by seatId)
 */
export async function resolveElection(
  db: Db,
  idOrElection: string | Election,
  options: ResolveElectionOptions,
  cycle?: number
): Promise<ElectionResponse | null> {
  const isFull = options.view === "full";

  let election: Election | null = null;
  if (typeof idOrElection === "string") {
    const id = idOrElection;
    if (isSeatId(id)) {
      const query: Record<string, unknown> = { seatId: id };
      if (cycle != null) {
        query.cycle = cycle;
        election = await db.collection<Election>("elections").findOne(query);
      } else {
        const candidates = await db
          .collection<Election>("elections")
          .find(query)
          .sort({ cycle: -1 })
          .limit(10)
          .toArray();
        // Priority: active > upcoming > most recent completed
        election =
          candidates.find((e) => e.status === "active") ??
          candidates.find((e) => e.status === "upcoming") ??
          candidates[0] ??
          null;
      }
    } else {
      let oid: MongoObjectId;
      try {
        oid = new ObjectId(id);
      } catch {
        return null; // invalid ObjectId
      }
      election = await db.collection<Election>("elections").findOne({ _id: oid });
    }
  } else {
    election = idOrElection;
  }

  if (!election) return null;

  // Fetch game state and game time in parallel with election deps
  const [gameState, gameTime, deps] = await Promise.all([
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
    getGameTime(),
    fetchDepsForElection(db, election, options.view),
  ]);

  // Adjacent elections for prev/next navigation (full view only)
  let adjacentElections: Array<{ _id: MongoObjectId; cycle: number; seatId?: string }> | null =
    null;
  if (isFull) {
    const adjacentQuery: Record<string, unknown> = election.seatId
      ? { seatId: election.seatId }
      : { state: election.state, electionType: election.electionType };
    if (!election.seatId && election.senateClass != null) {
      adjacentQuery.senateClass = election.senateClass;
    }
    adjacentElections = await db
      .collection<Election>("elections")
      .find(adjacentQuery)
      .sort({ cycle: 1 })
      .project<{ _id: MongoObjectId; cycle: number; seatId?: string }>({
        _id: 1,
        cycle: 1,
        seatId: 1,
      })
      .toArray();
  }

  return _enrichElection(election, deps, options, gameTime, gameState, db, adjacentElections);
}

// ---------------------------------------------------------------------------
// Batch entry point — resolves multiple elections with one round of DB queries
// ---------------------------------------------------------------------------

/**
 * Resolves multiple elections in batch, fetching all DB dependencies in a
 * single round of queries and then enriching each individually via
 * _enrichElection(). Avoids N+1 queries when rendering election list views.
 *
 * @param db        - MongoDB Db instance
 * @param elections - Pre-fetched Election documents to resolve
 * @param options   - { view, userId, isAdmin }
 */
export async function resolveElections(
  db: Db,
  elections: Election[],
  options: ResolveElectionOptions
): Promise<ElectionResponse[]> {
  if (elections.length === 0) return [];

  const { view, userId, isAdmin = false } = options;
  const isFull = view === "full";

  const electionIds = elections.map((e) => e._id);
  const electionIdStrings = new Set(electionIds.map((id) => id.toString()));
  const uniqueCountryIds = [...new Set(elections.map((e) => e.countryId ?? "US"))];

  // ── Step 1: Fetch all candidates across all elections in one query ──────────
  // For completed/resolved elections include all candidates; for active/upcoming
  // only active ones. We handle this by fetching all and filtering per-election
  // during slicing, matching the logic in fetchDepsForElection().
  const allCandidatesRaw = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ electionId: { $in: electionIds } })
    .toArray();

  const completedStatuses = new Set(["completed", "resolved"]);
  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const eid of electionIdStrings) candidatesByElection.set(eid, []);

  const electionStatusMap = new Map(elections.map((e) => [e._id.toString(), e.status]));
  for (const c of allCandidatesRaw) {
    const eid = c.electionId.toString();
    if (!electionIdStrings.has(eid)) continue;
    const status = electionStatusMap.get(eid) ?? "";
    if (!completedStatuses.has(status) && c.status !== "active") continue;
    candidatesByElection.get(eid)!.push(c);
  }

  // ── Step 2: Collect all character IDs and NPP IDs across all candidates ─────
  const allCharIdSet = new Set<string>();
  const allNppIds: MongoObjectId[] = [];

  for (const candidates of candidatesByElection.values()) {
    for (const c of candidates) {
      if (!c.isNPP) allCharIdSet.add(c.characterId.toString());
      if (c.runningMateId) allCharIdSet.add(c.runningMateId.toString());
      if (c.isNPP && c.nppId) allNppIds.push(c.nppId);
    }
  }

  const allCharIds = [...allCharIdSet].map((s) => new ObjectId(s));

  // ── Step 3: Batch-fetch characters, NPPs, parties in parallel ───────────────
  // In full view, also fetch endorsements, campaigns, tallies, snapshots.
  // Also batch-fetch incumbents for single-seat races in one round of queries.
  const SINGLE_SEAT_TYPES = new Set([
    "senate",
    "governor",
    "president",
    "primeMinister",
    "uachtaran",
  ]);
  const hasSingleSeat = elections.some((e) => SINGLE_SEAT_TYPES.has(e.electionType));

  const [
    gameState,
    gameTime,
    characters,
    npps,
    parties,
    talliesRaw,
    incumbentCharsRaw,
    incumbentNPPsRaw,
  ] = await Promise.all([
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
    getGameTime(),
    allCharIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: allCharIds } })
          .toArray()
      : Promise.resolve([] as Character[]),
    allNppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: allNppIds } })
          .toArray()
      : Promise.resolve([] as NPP[]),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: { $in: uniqueCountryIds } })
      .toArray(),
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } })
      .toArray(),
    hasSingleSeat
      ? db
          .collection<Character>("characters")
          .find(
            {
              countryId: { $in: uniqueCountryIds },
              "currentOffice.type": { $in: [...SINGLE_SEAT_TYPES] },
            },
            { projection: { _id: 1, name: 1, party: 1, countryId: 1, currentOffice: 1 } }
          )
          .toArray()
      : Promise.resolve([] as Character[]),
    hasSingleSeat
      ? db
          .collection<NPP>("npps")
          .find(
            {
              countryId: { $in: uniqueCountryIds },
              "currentOffice.type": { $in: [...SINGLE_SEAT_TYPES] },
            },
            { projection: { _id: 1, name: 1, party: 1, countryId: 1, currentOffice: 1 } }
          )
          .toArray()
      : Promise.resolve([] as NPP[]),
  ]);

  const tallyByElection = new Map<string, ElectionVoteTally>(
    talliesRaw.map((t) => [t.electionId.toString(), t])
  );

  const incumbentByElection = new Map<string, { name: string; partyId: string } | null>(
    elections.map((e) => [e._id.toString(), null])
  );
  const allIncumbentHolders = [...incumbentCharsRaw, ...incumbentNPPsRaw];
  // Bucket holders by country+office so each election scans only its own
  // office's holders instead of the full list (was O(elections × holders)).
  const holdersByCountryOffice = new Map<string, typeof allIncumbentHolders>();
  for (const h of allIncumbentHolders) {
    if (!h.currentOffice) continue;
    const key = `${h.countryId ?? "US"}:${h.currentOffice.type}`;
    const bucket = holdersByCountryOffice.get(key) ?? [];
    bucket.push(h);
    holdersByCountryOffice.set(key, bucket);
  }
  for (const election of elections) {
    if (!SINGLE_SEAT_TYPES.has(election.electionType)) continue;
    const isNational =
      election.electionType === "president" ||
      election.electionType === "primeMinister" ||
      election.electionType === "uachtaran";
    const electionCountryId = election.countryId ?? "US";
    const candidatesForOffice =
      holdersByCountryOffice.get(`${electionCountryId}:${election.electionType}`) ?? [];
    const holder = candidatesForOffice.find((h) => {
      if (!h.currentOffice) return false;
      if (h.currentOffice.type !== election.electionType) return false;
      // Cross-country guard: only match holders in the same country as the
      // election. A US presidential election must not match a CN-seated
      // executive (or vice versa). Default missing holder.countryId to "US"
      // for backward compat with legacy character rows.
      if ((h.countryId ?? "US") !== electionCountryId) return false;
      if (!isNational && "state" in h.currentOffice && h.currentOffice.state !== election.state)
        return false;
      if (
        election.electionType === "senate" &&
        election.senateClass != null &&
        "senateClass" in h.currentOffice &&
        h.currentOffice.senateClass !== election.senateClass
      )
        return false;
      return true;
    });
    if (holder)
      incumbentByElection.set(election._id.toString(), {
        name: holder.name,
        partyId: holder.party,
      });
  }

  // ── Step 4 (full view): batch-fetch endorsements, campaigns, snapshots ───────
  const nppEndorsementsByElection = new Map<string, NPPEndorsement[]>();
  const playerEndorsementsByElection = new Map<string, PlayerEndorsement[]>();
  const snapshotsByElection = new Map<string, PrimarySnapshot[]>();
  const campaignsByElection = new Map<string, Campaign[]>();
  let statePartyOrgs: StatePartyOrg[] = [];

  if (isFull) {
    const hasPresident = elections.some((e) => e.electionType === "president");
    const [
      nppEndorsementsRaw,
      playerEndorsementsRaw,
      snapshotsRaw,
      campaignsRaw,
      statePartyOrgsRaw,
    ] = await Promise.all([
      db
        .collection<NPPEndorsement>("nppEndorsements")
        .find(buildActiveVisibleNppEndorsementFilter({ electionId: { $in: electionIds } }))
        .toArray(),
      db
        .collection<PlayerEndorsement>("playerEndorsements")
        .find({ electionId: { $in: electionIds }, isActive: true })
        .toArray(),
      // Only the last 72 snapshots per election are kept (see snapsLimited),
      // so cap the fetch in the DB instead of loading full history and
      // slicing in JS.
      db
        .collection<PrimarySnapshot>("primarySnapshots")
        .aggregate<PrimarySnapshot>([
          { $match: { electionId: { $in: electionIds } } },
          { $sort: { electionId: 1, recordedAt: -1 } },
          {
            $group: { _id: "$electionId", docs: { $push: "$$ROOT" } },
          },
          { $project: { docs: { $slice: ["$docs", 72] } } },
          { $unwind: "$docs" },
          { $replaceRoot: { newRoot: "$docs" } },
          { $sort: { recordedAt: 1 } },
        ])
        .toArray(),
      db
        .collection<Campaign>("campaigns")
        .find(
          { electionId: { $in: electionIds } },
          { projection: { _id: 1, candidateId: 1, funds: 1, electionId: 1 } }
        )
        .toArray(),
      hasPresident
        ? db
            .collection<StatePartyOrg>("statePartyOrg")
            .find(
              {
                countryId: {
                  $in: [
                    ...new Set(
                      elections
                        .filter((e) => e.electionType === "president")
                        .map((e) => e.countryId ?? "US")
                    ),
                  ],
                },
              },
              {
                projection: {
                  stateId: 1,
                  partyId: 1,
                  countryId: 1,
                  organization: 1,
                  primarySurge: 1,
                  primaryAllocation: 1,
                },
              }
            )
            .toArray()
        : Promise.resolve([] as StatePartyOrg[]),
    ]);

    statePartyOrgs = statePartyOrgsRaw;

    // Index by election ID
    for (const eid of electionIdStrings) {
      nppEndorsementsByElection.set(eid, []);
      playerEndorsementsByElection.set(eid, []);
      snapshotsByElection.set(eid, []);
      campaignsByElection.set(eid, []);
    }
    for (const e of nppEndorsementsRaw) {
      const eid = e.electionId.toString();
      nppEndorsementsByElection.get(eid)?.push(e);
    }
    for (const e of playerEndorsementsRaw) {
      const eid = e.electionId.toString();
      playerEndorsementsByElection.get(eid)?.push(e);
    }
    for (const s of snapshotsRaw) {
      const eid = s.electionId.toString();
      snapshotsByElection.get(eid)?.push(s);
    }
    for (const c of campaignsRaw) {
      const eid = c.electionId.toString();
      campaignsByElection.get(eid)?.push(c);
    }
  }

  // ── Step 5 (summary view): batch-fetch latest primary snapshot per election ──
  // For full view snapshots are already fetched; pick last per election below.
  const latestSnapshotByElection = new Map<string, PrimarySnapshot>();

  if (!isFull) {
    const latestSnapshotAgg = await db
      .collection<PrimarySnapshot>("primarySnapshots")
      .aggregate<{ _id: MongoObjectId; doc: PrimarySnapshot }>([
        { $match: { electionId: { $in: electionIds } } },
        { $sort: { recordedAt: -1 } },
        { $group: { _id: "$electionId", doc: { $first: "$$ROOT" } } },
      ])
      .toArray();
    for (const row of latestSnapshotAgg) {
      latestSnapshotByElection.set(row._id.toString(), row.doc);
    }
  } else {
    // Full view: pick last snapshot per election from the already-fetched array
    for (const [eid, snaps] of snapshotsByElection.entries()) {
      if (snaps.length > 0) {
        latestSnapshotByElection.set(eid, snaps[snaps.length - 1]);
      }
    }
  }

  // ── Step 6: Build per-election deps and enrich ──────────────────────────────
  // _enrichElection() does its own internal DB query for myCharId in full view
  // (one query per election). In summary mode userId is effectively ignored
  // inside _enrichElection() (the myCharId branch is guarded by `isFull`), so
  // there is no redundant query in summary mode.
  //
  // If the per-election myCharId lookup becomes a perf concern in full-view
  // list pages, refactor _enrichElection() to accept an optional myCharId
  // parameter and pre-fetch it once here.

  const results: ElectionResponse[] = await Promise.all(
    elections.map((election) => {
      const eid = election._id.toString();
      const candidates = candidatesByElection.get(eid) ?? [];
      // Scope characters and NPPs to this election's candidates
      const candidateCharIds = new Set(
        candidates.filter((c) => !c.isNPP).map((c) => c.characterId.toString())
      );
      const runningMateCharIds = new Set(
        candidates.filter((c) => c.runningMateId).map((c) => c.runningMateId!.toString())
      );
      const electionCharIds = new Set([...candidateCharIds, ...runningMateCharIds]);
      const electionNppIds = new Set(
        candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!.toString())
      );

      const electionChars = characters.filter((c) => electionCharIds.has(c._id.toString()));
      const electionNpps = npps.filter((n) => electionNppIds.has(n._id.toString()));
      // Parties: scoped by countryId (already filtered globally, subset by country)
      const electionCountryId = election.countryId ?? "US";
      const electionParties = parties.filter((p) => (p.countryId ?? "US") === electionCountryId);

      const snapsForElection = snapshotsByElection.get(eid) ?? [];
      // Limit snapshot history to last 72 entries (matching single-election logic)
      const snapsLimited = isFull ? snapsForElection.slice(-72) : [];

      const deps: ElectionDeps = {
        candidates,
        characters: electionChars,
        npps: electionNpps,
        parties: electionParties,
        nppEndorsements: nppEndorsementsByElection.get(eid) ?? [],
        playerEndorsements: playerEndorsementsByElection.get(eid) ?? [],
        snapshots: snapsLimited,
        statePartyOrgs,
        campaigns: campaignsByElection.get(eid) ?? [],
        tally: tallyByElection.get(eid) ?? null,
        latestPrimarySnapshot: latestSnapshotByElection.get(eid) ?? null,
        incumbent: incumbentByElection.get(eid) ?? null,
      };

      // In list mode, no prev/next navigation is needed
      return _enrichElection(election, deps, { view, userId, isAdmin }, gameTime, gameState, db);
    })
  );

  return results;
}
