import type { CountryId } from "@/lib/constants/countries";
import type { Db, Filter } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty,
  Character,
  NPP,
  PrimarySnapshot,
} from "@/lib/db/types";
import { computeElectionPhase } from "@/lib/elections/phases";
import { getGameTime, type GameTimeContext } from "@/lib/time/gameTime";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

/**
 * The phase a race is actually in. `Election.status` cannot answer this — it is
 * "active" for the whole run of a race, primary and general alike — so the phase
 * is derived from the turn/time bounds via the shared `computeElectionPhase`.
 */
export type PublicElectionPhase = "upcoming" | "primary" | "general" | "ended" | "cancelled";

type ElectionPhaseFields = Pick<
  Election,
  "status" | "startTime" | "primaryEndTime" | "endTime" | "startTurn" | "primaryEndTurn" | "endTurn"
>;

/**
 * Candidate rows are withdrawn, never deleted, and are deliberately kept as
 * history. Entering a race withdraws any prior row for that character and
 * inserts a fresh one, and the primary resolver withdraws the losers, so a race
 * accumulates one dead row per departure.
 *
 * Publishing them in one flat list reads as though they are all still running:
 * a character who re-entered appears once per attempt, and primary losers never
 * leave the ballot. So the response splits them — `candidates` is who is still
 * standing, `formerCandidates` is every departure, kept with its `withdrawnAt`.
 * The same split applies to a finished race, whose general-election losers are
 * still `active` and so remain in `candidates`.
 *
 * `!== "withdrawn"` rather than `=== "active"` so a legacy row with no status is
 * treated as standing rather than silently reclassified as history.
 */
function isStandingCandidate(candidate: Pick<ElectionCandidate, "status">): boolean {
  return candidate.status !== "withdrawn";
}

/**
 * Whether the result is authoritative. The derived phase says a race is over the
 * moment its end turn passes, but the resolver runs on a later turn and the
 * totals can still move until it does. Only `status` records that it has run, so
 * `finalized` must come from status rather than from the phase — otherwise a
 * race reports final numbers that are still being counted.
 */
function hasResolvedResult(status: Election["status"]): boolean {
  return status === "completed" || status === "resolved";
}

/**
 * Per-candidate vote breakdown for one race, drawn from the tally the list query
 * already loaded. Surfaced only when the caller opts in with `results=true`, so a
 * bot can pull detailed seat-by-seat numbers for a whole country in ONE call
 * rather than a `/elections/[id]` request per race (ticket #1229). The heavy
 * time-series (turn-by-turn snapshots, primary snapshots) is deliberately left
 * behind `/elections/[id]` — this is the standings, not the full history.
 *
 * Shares are computed off the total on the row, so they sum to ~100 even before
 * the result is finalised; `finalized` says whether the count is done.
 */
type PublicCandidateStats =
  | Pick<Character, "favorability" | "politicalInfluence">
  | Pick<NPP, "favorability" | "politicalInfluence">;

function toElectionResults(
  tally: ElectionVoteTally,
  statsById: Map<string, PublicCandidateStats>,
  isMultiSeat: boolean
) {
  const totalVotes = Object.values(tally.totalVotes ?? {}).reduce((a, b) => a + b, 0);
  const candidates = Object.entries(tally.totalVotes ?? {})
    .map(([candidateId, votes]) => {
      const stats = statsById.get(candidateId);
      return {
        characterId: candidateId,
        characterName: tally.candidateNames?.[candidateId] ?? null,
        party: tally.candidateParties?.[candidateId] ?? null,
        votes,
        sharePct: totalVotes > 0 ? Math.round((votes / totalVotes) * 10000) / 100 : 0,
        favorability: stats?.favorability ?? null,
        politicalInfluence: stats?.politicalInfluence ?? null,
      };
    })
    .sort((a, b) => b.votes - a.votes);

  return {
    totalVotes,
    finalized: tally.finalized ?? false,
    ...(isMultiSeat ? { seatsEstimate: tally.seatsEstimate ?? null } : {}),
    candidates,
  };
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/** Most recent departure first, so the newest history reads at the top. */
function byMostRecentDeparture(
  a: Pick<ElectionCandidate, "withdrawnAt">,
  b: Pick<ElectionCandidate, "withdrawnAt">
): number {
  return toTime(b.withdrawnAt) - toTime(a.withdrawnAt);
}

/**
 * Resolve a race's phase plus the deadline of that phase. `startTime` alone is
 * not actionable for a consumer — it only says when the race spawned — so the
 * boundary that is actually approaching is surfaced as `phaseEndTurn` /
 * `phaseEndTime` (primary close during a primary, poll close during a general,
 * race open while upcoming).
 */
function resolveElectionPhase(election: ElectionPhaseFields, gameTime: GameTimeContext) {
  // A cancelled race never runs, so it sits in none of the running phases and
  // has no deadline left to report. Its turn bounds are still published on the
  // row; they just no longer describe anything that will happen.
  if (election.status === "cancelled") {
    return {
      phase: "cancelled" as const,
      flags: { isUpcoming: false, inPrimary: false, inGeneral: false, isEnded: false },
      phaseEndTurn: null,
      phaseEndTime: null,
    };
  }

  const flags = computeElectionPhase(
    election.startTime ?? null,
    election.primaryEndTime ?? null,
    election.endTime ?? null,
    election.status,
    gameTime,
    {
      startTurn: election.startTurn,
      primaryEndTurn: election.primaryEndTurn,
      endTurn: election.endTurn,
    }
  );

  let phase: PublicElectionPhase;
  if (flags.isEnded) phase = "ended";
  else if (flags.isUpcoming) phase = "upcoming";
  else if (flags.inPrimary) phase = "primary";
  else phase = "general";

  let endTurn: number | null | undefined = null;
  let endTime: Date | null | undefined = null;
  if (phase === "upcoming") {
    endTurn = election.startTurn;
    endTime = election.startTime;
  } else if (phase === "primary") {
    endTurn = election.primaryEndTurn;
    endTime = election.primaryEndTime;
  } else if (phase === "general") {
    endTurn = election.endTurn;
    endTime = election.endTime;
  }

  return {
    phase,
    flags,
    phaseEndTurn: endTurn ?? null,
    phaseEndTime: toIso(endTime),
  };
}

export async function queryElectionList(
  db: Db,
  params: { country: string; state?: string; results?: boolean }
) {
  const { country, state, results } = params;
  const query: Record<string, unknown> = { countryId: country };
  if (state) query.state = state;

  const elections = await db
    .collection<Election>("elections")
    .find(query)
    .sort({ startTime: -1 })
    .toArray();

  if (elections.length === 0) return { found: false, elections: [] };

  const electionIds = elections.map((e) => e._id);
  const [allCandidates, allTallies] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds } })
      .toArray(),
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } })
      .toArray(),
  ]);

  // Look up party colors
  const partySeqIds = [...new Set(allCandidates.map((c) => c.party))].map(Number).filter(Boolean);
  const parties =
    partySeqIds.length > 0
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({
            sequentialId: { $in: partySeqIds },
            countryId: country,
          } as Filter<PoliticalParty>)
          .toArray()
      : [];
  const partyColorMap = new Map(parties.map((p) => [String(p.sequentialId), p.color]));

  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const c of allCandidates) {
    const key = c.electionId.toString();
    if (!candidatesByElection.has(key)) candidatesByElection.set(key, []);
    candidatesByElection.get(key)!.push(c);
  }

  const talliesByElection = new Map<string, ElectionVoteTally>();
  for (const t of allTallies) {
    talliesByElection.set(t.electionId.toString(), t);
  }

  const candidateCharacterIds = allCandidates
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => c.characterId)
    .filter((id): id is ObjectId => id != null);
  const candidateNppIds = allCandidates
    .filter((c) => c.isNPP && c.nppId)
    .map((c) => c.nppId)
    .filter((id): id is ObjectId => id != null);
  const [characters, npps] = await Promise.all([
    candidateCharacterIds.length > 0
      ? db
          .collection<Pick<Character, "_id" | "favorability" | "politicalInfluence">>("characters")
          .find({ _id: { $in: candidateCharacterIds } })
          .project<Pick<Character, "_id" | "favorability" | "politicalInfluence">>({
            _id: 1,
            favorability: 1,
            politicalInfluence: 1,
          })
          .toArray()
      : Promise.resolve([]),
    candidateNppIds.length > 0
      ? db
          .collection<Pick<NPP, "_id" | "favorability" | "politicalInfluence">>("npps")
          .find({ _id: { $in: candidateNppIds } })
          .project<Pick<NPP, "_id" | "favorability" | "politicalInfluence">>({
            _id: 1,
            favorability: 1,
            politicalInfluence: 1,
          })
          .toArray()
      : Promise.resolve([]),
  ]);
  const statsById = new Map<string, PublicCandidateStats>();
  for (const character of characters) statsById.set(character._id.toString(), character);
  for (const npp of npps) statsById.set(npp._id.toString(), npp);

  const gameTime = await getGameTime();

  const toListCandidate = (c: ElectionCandidate) => ({
    characterId: c.characterId?.toString() ?? null,
    characterName: c.characterName,
    party: c.party,
    partyColor: partyColorMap.get(c.party) ?? null,
    isNPP: c.isNPP ?? false,
    status: c.status ?? "active",
  });

  const result = elections.map((e) => {
    const rows = candidatesByElection.get(e._id.toString()) ?? [];
    const candidates = rows.filter(isStandingCandidate).map(toListCandidate);
    const formerCandidates = rows
      .filter((c) => !isStandingCandidate(c))
      .sort(byMostRecentDeparture)
      .map((c) => ({ ...toListCandidate(c), withdrawnAt: toIso(c.withdrawnAt) }));

    const { phase, flags, phaseEndTurn, phaseEndTime } = resolveElectionPhase(e, gameTime);
    const isEnded = flags.isEnded;
    const tally = talliesByElection.get(e._id.toString());
    const finalVotes =
      isEnded && tally
        ? {
            totalVotes: Object.values(tally.totalVotes ?? {}).reduce((a, b) => a + b, 0),
            finalized: hasResolvedResult(e.status),
          }
        : undefined;

    return {
      id: e._id.toString(),
      seatId: e.seatId ?? null,
      electionType: e.electionType,
      state: e.state,
      stateName: ((e as Record<string, unknown>).stateName as string) ?? e.state,
      status: e.status,
      phase,
      startTime: toIso(e.startTime),
      primaryEndTime: toIso(e.primaryEndTime),
      endTime: toIso(e.endTime),
      startTurn: e.startTurn ?? null,
      primaryEndTurn: e.primaryEndTurn ?? null,
      endTurn: e.endTurn ?? null,
      phaseEndTime,
      phaseEndTurn,
      candidates,
      formerCandidates,
      ...(finalVotes ? { finalVotes } : {}),
      // Opt-in: detailed per-candidate standings from the tally already loaded
      // above, so `?results=true` costs no extra query. `null` when a race has
      // no tally yet, to stay distinguishable from a race with zero votes cast.
      ...(results
        ? {
            results: tally ? toElectionResults(tally, statsById, (e.totalSeats ?? 1) > 1) : null,
          }
        : {}),
    };
  });

  return { found: true, elections: result };
}

export async function queryElectionDetail(db: Db, electionId: string) {
  let election: Election | null = null;
  try {
    election = await db
      .collection<Election>("elections")
      .findOne({ _id: new ObjectId(electionId) });
  } catch {
    return null;
  }
  if (!election) return null;

  const electionOid = election._id;

  const [allCandidateRows, tally, snapshots] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: electionOid })
      .toArray(),
    db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId: electionOid }),
    db
      .collection<PrimarySnapshot>("primarySnapshots")
      .find({ electionId: electionOid })
      .sort({ recordedAt: 1 })
      .limit(72)
      .toArray(),
  ]);

  const candidates = allCandidateRows.filter(isStandingCandidate);
  const departedRows = allCandidateRows
    .filter((c) => !isStandingCandidate(c))
    .sort(byMostRecentDeparture);

  // Resolve prior-cycle election to find incumbent
  const priorElection =
    election.cycle && election.cycle > 1
      ? await db.collection<Election>("elections").findOne({
          seatId: election.seatId,
          cycle: election.cycle - 1,
          status: { $in: ["completed", "resolved"] },
        })
      : null;

  const incumbentCandidateId = (priorElection as Record<string, unknown> | null)?.winnerId as
    string | undefined;
  // Searched across every row, standing or not: the incumbent holds the seat
  // whether or not they are still on the ballot, so losing a primary or
  // withdrawing must not erase who the sitting officeholder is.
  const incumbentCandidate = incumbentCandidateId
    ? allCandidateRows.find((c) => c.characterId?.toString() === incumbentCandidateId)
    : null;

  const incumbent = incumbentCandidate
    ? { name: incumbentCandidate.characterName, party: incumbentCandidate.party }
    : null;

  // Look up party info for candidates
  // Departed rows are resolved too, so a former candidacy still reads with its
  // party name and colour rather than a bare sequential id.
  const partySeqIds = [...new Set(allCandidateRows.map((c) => c.party))]
    .map(Number)
    .filter(Boolean);
  const parties =
    partySeqIds.length > 0
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({
            sequentialId: { $in: partySeqIds },
            countryId: (election as unknown as Record<string, unknown>).countryId ?? "US",
          } as Filter<PoliticalParty>)
          .toArray()
      : [];
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

  // Clean primarySnapshots — only turn index, candidate name, sharePct
  const primarySnapshots = snapshots.map((s, idx) => ({
    turn: idx + 1,
    candidates: Object.values(s.byParty)
      .flat()
      .map((e) => ({ name: e.characterName, sharePct: e.sharePct })),
  }));

  const gameTime = await getGameTime();
  const { phase, flags, phaseEndTurn, phaseEndTime } = resolveElectionPhase(election, gameTime);
  const { inPrimary, inGeneral, isUpcoming, isEnded } = flags;

  const isSingleSeat = !election.totalSeats || election.totalSeats === 1;

  const latestTallySnapshot =
    tally && tally.turnSnapshots && tally.turnSnapshots.length > 0
      ? {
          turn: tally.turnSnapshots[tally.turnSnapshots.length - 1].turn,
          cumulativeVotes: Object.values(
            tally.turnSnapshots[tally.turnSnapshots.length - 1].cumulativeVotes
          ).reduce((a, b) => a + b, 0),
          sharesPct: tally.turnSnapshots[tally.turnSnapshots.length - 1].sharesPct,
        }
      : null;

  const toDetailCandidate = (c: ElectionCandidate) => {
    const party = partyMap.get(c.party);
    return {
      id: c._id.toString(),
      characterId: c.characterId?.toString() ?? null,
      characterName: c.characterName,
      avatarUrl: null,
      party: party?.name ?? c.party,
      partyId: party?._id?.toString() ?? null,
      partyColor: party?.color ?? null,
      isNPP: c.isNPP ?? false,
      status: c.status ?? "active",
      favorability: null,
      politicalInfluence: null,
      economicPosition: null,
      socialPosition: null,
      primaryScore: null,
      sharePct: null,
      endorsementCount: 0,
      endorsements: [],
      runningMateName: null,
      campaignFunds: null,
      profileUrl: c.characterId ? `${BASE_URL}/character/${c.characterId}` : null,
    };
  };

  const mappedCandidates = candidates.map(toDetailCandidate);
  const mappedFormerCandidates = departedRows.map((c) => ({
    ...toDetailCandidate(c),
    withdrawnAt: toIso(c.withdrawnAt),
  }));

  return {
    election: {
      id: election._id.toString(),
      seatId: election.seatId ?? null,
      electionType: election.electionType,
      state: election.state,
      stateName:
        ((election as unknown as Record<string, unknown>).stateName as string) ?? election.state,
      countryId: ((election as unknown as Record<string, unknown>).countryId as string) ?? null,
      cycle: election.cycle,
      status: election.status,
      phase,
      totalSeats: election.totalSeats ?? 1,
      startTime: toIso(election.startTime),
      endTime: toIso(election.endTime),
      primaryEndTime: toIso(election.primaryEndTime),
      startTurn: election.startTurn ?? null,
      primaryEndTurn: election.primaryEndTurn ?? null,
      endTurn: election.endTurn ?? null,
      phaseEndTime,
      phaseEndTurn,
      url: `${BASE_URL}/elections/${election._id}`,
    },
    phase: { current: phase, inPrimary, inGeneral, isUpcoming, isEnded },
    incumbent,
    candidates: mappedCandidates,
    formerCandidates: mappedFormerCandidates,
    primarySnapshots,
    votes: tally
      ? {
          totalVotes: Object.values(tally.totalVotes ?? {}).reduce((a, b) => a + b, 0),
          finalized: hasResolvedResult(election.status),
          latestSnapshot: latestTallySnapshot,
          ...(!isSingleSeat ? { seatsEstimate: tally.seatsEstimate ?? null } : {}),
        }
      : null,
  };
}

/**
 * Archived (completed/resolved) elections for a country, newest first.
 * Returns one row per election with the winner and final tally summary;
 * full candidate/vote detail stays behind /elections/[id].
 */
export async function queryElectionArchives(
  db: Db,
  params: { country: string; limit?: number; type?: string }
) {
  const { country, type } = params;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const cid = country.toUpperCase() as CountryId;

  const filter: Record<string, unknown> = {
    countryId: cid,
    status: { $in: ["ended", "completed", "resolved"] },
  };
  if (type) filter.electionType = type;

  const elections = await db
    .collection<Election>("elections")
    .find(filter)
    .sort({ endTime: -1 })
    .limit(limit)
    .toArray();

  if (elections.length === 0) return { found: false, elections: [] as unknown[] };

  const electionIds = elections.map((e) => e._id);
  const [allCandidates, allTallies] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds } })
      .toArray(),
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } })
      .toArray(),
  ]);

  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const c of allCandidates) {
    const key = c.electionId.toString();
    if (!candidatesByElection.has(key)) candidatesByElection.set(key, []);
    candidatesByElection.get(key)!.push(c);
  }
  const talliesByElection = new Map<string, ElectionVoteTally>();
  for (const t of allTallies) talliesByElection.set(t.electionId.toString(), t);

  return {
    found: true,
    elections: elections.map((e) => {
      const key = e._id.toString();
      const candidates = candidatesByElection.get(key) ?? [];
      const tally = talliesByElection.get(key);

      // Finalized winner = top of the final vote tally (candidates are not
      // flagged as winners on the document; the tally is the record).
      let winner: { characterName: string; party: string; votes: number } | null = null;
      if (tally?.totalVotes) {
        const top = Object.entries(tally.totalVotes).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] > 0) {
          winner = {
            characterName:
              tally.candidateNames?.[top[0]] ??
              candidates.find((c) => c.characterId?.toString() === top[0])?.characterName ??
              "Unknown",
            party: tally.candidateParties?.[top[0]] ?? "Independent",
            votes: top[1],
          };
        }
      }

      return {
        id: e._id.toString(),
        seatId: e.seatId ?? null,
        electionType: e.electionType,
        state: e.state,
        cycle: e.cycle ?? null,
        electionYear: e.electionYear ?? null,
        totalSeats: e.totalSeats ?? null,
        startTime: e.startTime?.toISOString() ?? null,
        endTime: e.endTime?.toISOString() ?? null,
        status: e.status,
        totalVotes: tally ? Object.values(tally.totalVotes ?? {}).reduce((a, b) => a + b, 0) : null,
        finalized: tally?.finalized ?? false,
        candidateCount: candidates.length,
        winner,
      };
    }),
  };
}
