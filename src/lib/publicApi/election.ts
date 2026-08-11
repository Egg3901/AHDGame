import type { Db, Filter } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty,
  PrimarySnapshot,
} from "@/lib/db/types";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

export async function queryElectionList(db: Db, params: { country: string; state?: string }) {
  const { country, state } = params;
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

  const result = elections.map((e) => {
    const candidates = (candidatesByElection.get(e._id.toString()) ?? []).map((c) => ({
      characterId: c.characterId?.toString() ?? null,
      characterName: c.characterName,
      party: c.party,
      partyColor: partyColorMap.get(c.party) ?? null,
      isNPP: c.isNPP ?? false,
    }));

    const status = e.status as string;
    const isEnded = status === "ended" || status === "completed" || status === "resolved";
    const tally = talliesByElection.get(e._id.toString());
    const finalVotes =
      isEnded && tally
        ? {
            totalVotes: Object.values(tally.totalVotes ?? {}).reduce((a, b) => a + b, 0),
            finalized: true,
          }
        : undefined;

    return {
      id: e._id.toString(),
      seatId: e.seatId ?? null,
      electionType: e.electionType,
      state: e.state,
      stateName: ((e as Record<string, unknown>).stateName as string) ?? e.state,
      status: e.status,
      startTime: e.startTime?.toISOString() ?? null,
      endTime: e.endTime?.toISOString() ?? null,
      candidates,
      ...(finalVotes ? { finalVotes } : {}),
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

  const [candidates, tally, snapshots] = await Promise.all([
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
  const incumbentCandidate = incumbentCandidateId
    ? candidates.find((c) => c.characterId?.toString() === incumbentCandidateId)
    : null;

  const incumbent = incumbentCandidate
    ? { name: incumbentCandidate.characterName, party: incumbentCandidate.party }
    : null;

  // Look up party info for candidates
  const partySeqIds = [...new Set(candidates.map((c) => c.party))].map(Number).filter(Boolean);
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

  const electionStatus = election.status as string;
  const inPrimary = electionStatus === "primary";
  const inGeneral = electionStatus === "general" || electionStatus === "active";
  const isEnded =
    electionStatus === "ended" || electionStatus === "completed" || electionStatus === "resolved";

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

  const mappedCandidates = candidates.map((c) => {
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
  });

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
      totalSeats: election.totalSeats ?? 1,
      startTime: election.startTime?.toISOString() ?? null,
      endTime: election.endTime?.toISOString() ?? null,
      primaryEndTime: (election as unknown as Record<string, unknown>).primaryEndTime
        ? ((election as unknown as Record<string, unknown>).primaryEndTime as Date).toISOString()
        : null,
      url: `${BASE_URL}/elections/${election._id}`,
    },
    phase: { inPrimary, inGeneral, isUpcoming: election.status === "upcoming", isEnded },
    incumbent,
    candidates: mappedCandidates,
    primarySnapshots,
    votes: tally
      ? {
          totalVotes: Object.values(tally.totalVotes ?? {}).reduce((a, b) => a + b, 0),
          finalized: isEnded,
          latestSnapshot: latestTallySnapshot,
          ...(!isSingleSeat ? { seatsEstimate: tally.seatsEstimate ?? null } : {}),
        }
      : null,
  };
}
