import type { Db } from "mongodb";
import type { Election, ElectionVoteTally, PoliticalParty } from "@/lib/db/types";

/**
 * Live state lean from the world's own history.
 *
 * Committed county PVIs are real-world baselines (2020/2024). A world that has
 * played its own presidential elections should see its counties move with it,
 * so the lean shown on the field-office map is
 *
 *   countyLive = countyBase - stateBase + stateLive
 *
 * where `stateLive` is the state's two-party right share minus the national
 * right share, in points, from the most recent finished presidential race.
 * Left/right is the party's economic position sign, the same convention the
 * subdivision results distributor uses. Before any presidential race has
 * finished, `stateLive` is absent and the baseline stands.
 */

export interface LiveStateLean {
  /** State id → live PVI (points, positive = right). */
  byState: Map<string, number>;
  /** Election whose result fed the map, for display ("as of the 1992 race"). */
  sourceElectionId: string;
  sourceYear: number | null;
}

const FINISHED: Election["status"][] = ["completed", "resolved"];

export async function loadLiveStateLean(db: Db, countryId: string): Promise<LiveStateLean | null> {
  const election = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: countryId as Election["countryId"],
        electionType: "president",
        status: { $in: FINISHED },
      },
      { projection: { _id: 1, endTurn: 1, electionYear: 1 } }
    )
    .sort({ endTurn: -1, _id: -1 })
    .limit(1)
    .next();
  if (!election) return null;

  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne(
      { electionId: election._id },
      { projection: { totalVotesByUnit: 1, candidateParties: 1 } }
    );
  const byUnit = tally?.totalVotesByUnit;
  if (!byUnit || !tally.candidateParties) return null;

  const seqIds = [...new Set(Object.values(tally.candidateParties))].map(Number).filter(Boolean);
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { sequentialId: { $in: seqIds }, countryId: countryId as PoliticalParty["countryId"] },
      { projection: { sequentialId: 1, economicPosition: 1 } }
    )
    .toArray();
  const econBySeq = new Map(parties.map((p) => [String(p.sequentialId), p.economicPosition]));
  const side = (candidateId: string): number =>
    Math.sign(econBySeq.get(tally.candidateParties[candidateId]) ?? 0);

  const rightShare = (votes: Record<string, number>) => {
    let right = 0;
    let left = 0;
    for (const [cid, v] of Object.entries(votes)) {
      const s = side(cid);
      if (s > 0) right += v;
      else if (s < 0) left += v;
    }
    return { right, left };
  };

  let natRight = 0;
  let natLeft = 0;
  const shares = new Map<string, number>();
  for (const [unitId, votes] of Object.entries(byUnit)) {
    const { right, left } = rightShare(votes);
    natRight += right;
    natLeft += left;
    // District units (ME-1, NE-2) roll into their state elsewhere; skip them.
    if (right + left > 0 && /^[A-Z]{2}$/.test(unitId)) shares.set(unitId, right / (right + left));
  }
  if (natRight + natLeft === 0) return null;
  const national = natRight / (natRight + natLeft);

  const byState = new Map<string, number>();
  for (const [stateId, s] of shares) byState.set(stateId, Math.round((s - national) * 1000) / 10);
  return {
    byState,
    sourceElectionId: election._id.toString(),
    sourceYear: election.electionYear ?? null,
  };
}
