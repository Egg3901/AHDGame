import type { Db, ObjectId } from "mongodb";
import type { Election, ElectionVoteTally, PoliticalParty } from "@/lib/db/types";

/**
 * County drift from the world's own history.
 *
 * Counties start on their era baseline (`src/data/county-leans`): a 1991
 * world opens on the 1984/1988 county map. As the world plays its own
 * presidential elections, each state's counties move together by that
 * state's swing between consecutive in-world races:
 *
 *   shift(state) = clamp(DAMPING * (pvi(last race) - pvi(race before)), +-CAP)
 *
 * Swing, not level: in-world results run far more polarised than real ones
 * (a founding round can put a state at 95/5), so replacing the baseline with
 * the in-world level would wreck the county map. The swing between two
 * in-world races is comparable with itself, and damping it keeps one wild
 * cycle from erasing the era's geography. A world with fewer than two
 * finished presidential races has no drift.
 *
 * PVI here is the state's two-party right share minus the national right
 * share, in points; left/right is the party's economic position sign, the
 * convention the subdivision results distributor uses.
 */

export const LIVE_DRIFT_DAMPING = 0.5;
export const LIVE_DRIFT_CAP = 10;

export interface LiveStateLean {
  /** State id → drift in PVI points to add to the era baseline. */
  shiftByState: Map<string, number>;
  /** Years of the two races the swing is measured between, for display. */
  sourceYear: number | null;
  priorYear: number | null;
}

const FINISHED: Election["status"][] = ["completed", "resolved"];

export async function loadLiveStateLean(db: Db, countryId: string): Promise<LiveStateLean | null> {
  const races = await db
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
    .limit(2)
    .toArray();
  if (races.length < 2) return null;
  const [last, prior] = races;
  const [lastPvi, priorPvi] = await Promise.all([
    statePviForRace(db, countryId, last._id),
    statePviForRace(db, countryId, prior._id),
  ]);
  if (!lastPvi || !priorPvi) return null;
  return {
    shiftByState: driftFromSwing(lastPvi, priorPvi),
    sourceYear: last.electionYear ?? null,
    priorYear: prior.electionYear ?? null,
  };
}

/** Pure: damped, capped per-state swing between two races' state PVIs. */
export function driftFromSwing(
  last: Map<string, number>,
  prior: Map<string, number>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [stateId, now] of last) {
    const before = prior.get(stateId);
    if (before === undefined) continue;
    const raw = LIVE_DRIFT_DAMPING * (now - before);
    out.set(
      stateId,
      Math.round(Math.max(-LIVE_DRIFT_CAP, Math.min(LIVE_DRIFT_CAP, raw)) * 10) / 10
    );
  }
  return out;
}

/** State id → two-party right PVI (points) for one presidential race. */
async function statePviForRace(
  db: Db,
  countryId: string,
  electionId: ObjectId
): Promise<Map<string, number> | null> {
  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId }, { projection: { totalVotesByUnit: 1, candidateParties: 1 } });
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

  let natRight = 0;
  let natLeft = 0;
  const shares = new Map<string, number>();
  for (const [unitId, votes] of Object.entries(byUnit)) {
    let right = 0;
    let left = 0;
    for (const [cid, v] of Object.entries(votes)) {
      const s = side(cid);
      if (s > 0) right += v;
      else if (s < 0) left += v;
    }
    natRight += right;
    natLeft += left;
    // District units (ME-1, NE-2) are not states; skip them.
    if (right + left > 0 && /^[A-Z]{2}$/.test(unitId)) shares.set(unitId, right / (right + left));
  }
  if (natRight + natLeft === 0) return null;
  const national = natRight / (natRight + natLeft);
  const out = new Map<string, number>();
  for (const [stateId, s] of shares) out.set(stateId, (s - national) * 100);
  return out;
}
