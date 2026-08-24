import { ObjectId, type Db } from "mongodb";
import type { Character, Election, ElectionCandidate, PlayerEndorsement } from "@/lib/db/types";
import { applyEndorsementSupportBump } from "@/lib/turn/elections/supportEvents";

/**
 * Party-alignment lifecycle for player endorsements (ticket #1179).
 *
 * Primaries are intra-party contests: the /president/primary/[partyId] surface
 * only ever offered the endorse control to same-party members. A membership
 * change must therefore not leave an active endorsement pointing at another
 * party's primary candidate — the stale row keeps counting in the standings
 * and keeps granting the endorsed campaign its per-turn player-endorsement
 * campaign actions long after the endorser defected.
 *
 * Cross-party endorsements are legal once a race reaches its general phase,
 * so alignment is only enforced while a race's primary is open.
 */

/** Time inputs for phase checks; `currentTurn` is preferred when present. */
export interface EndorsementPhaseClock {
  currentTurn?: number;
  now: Date;
}

/**
 * True while the election's primary phase is still open. Turn-first
 * (drift-immune) with the documented Date fallback for docs that carry no turn
 * bound — matching isPrimaryEnded / getEndorsementDecisionPhase semantics. A
 * race with no primary boundary at all counts as general (nothing to enforce).
 */
export function isPrimaryPhaseOpen(
  election: Pick<Election, "primaryEndTurn" | "primaryEndTime">,
  clock: EndorsementPhaseClock
): boolean {
  if (typeof election.primaryEndTurn === "number" && typeof clock.currentTurn === "number") {
    return clock.currentTurn < election.primaryEndTurn;
  }
  if (election.primaryEndTime) {
    return clock.now.getTime() < new Date(election.primaryEndTime).getTime();
  }
  return false;
}

interface WithdrawalContext {
  db: Db;
  currentTurn?: number;
  now: Date;
}

async function withdrawPrimaryMisalignedRows(
  ctx: WithdrawalContext,
  endorsements: PlayerEndorsement[],
  /** Explicit party per endorser when the caller knows it post-write; otherwise read live. */
  partyOverrides?: Map<string, string>
): Promise<number> {
  if (endorsements.length === 0) return 0;
  const { db, currentTurn, now } = ctx;

  const electionIds = [...new Set(endorsements.map((e) => e.electionId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const candidateIds = [...new Set(endorsements.map((e) => e.candidateId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const endorserIds = [...new Set(endorsements.map((e) => e.characterId.toString()))].map(
    (id) => new ObjectId(id)
  );

  const [elections, candidates, endorsers] = await Promise.all([
    db
      .collection<Election>("elections")
      .find({ _id: { $in: electionIds } })
      .toArray(),
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ _id: { $in: candidateIds } })
      .toArray(),
    db
      .collection<Character>("characters")
      .find({ _id: { $in: endorserIds } }, { projection: { _id: 1, party: 1 } })
      .toArray(),
  ]);

  const electionById = new Map(elections.map((e) => [e._id.toString(), e]));
  const candidateById = new Map(candidates.map((c) => [c._id.toString(), c]));
  const partyByEndorserId = new Map<string, string>();
  for (const [id, party] of partyOverrides ?? []) partyByEndorserId.set(id, party);
  for (const c of endorsers) {
    if (!partyByEndorserId.has(c._id.toString())) {
      partyByEndorserId.set(c._id.toString(), c.party ?? "independent");
    }
  }

  const misaligned: PlayerEndorsement[] = [];
  for (const e of endorsements) {
    const election = electionById.get(e.electionId.toString());
    // Ended races keep their endorsements as history; nothing is gained or
    // granted from them anymore, so leave the rows alone.
    if (!election || (election.status !== "active" && election.status !== "upcoming")) continue;
    if (!isPrimaryPhaseOpen(election, { currentTurn, now })) continue;
    const candidate = candidateById.get(e.candidateId.toString());
    if (!candidate || candidate.status !== "active") continue;
    // No party on the candidacy row (legacy data) — nothing to compare.
    if (!candidate.party) continue;

    const endorserParty = partyByEndorserId.get(e.characterId.toString()) ?? "independent";
    if (candidate.party === endorserParty) continue;

    misaligned.push(e);
  }
  if (misaligned.length === 0) return 0;

  // Reverse the landing Support bump exactly like DELETE /api/elections/[id]/endorse
  // does: ONCE PER WITHDRAWN ENDORSEMENT, not once per candidate.
  //
  // The bump ledger is per endorsement. POST adds a flat SUPPORT_ENDORSEMENT_BUMP
  // for every row created and DELETE removes one for every row deleted, so a
  // candidate carrying twenty endorsers is carrying twenty bumps. Collapsing the
  // reversal to one per candidate leaves the other nineteen behind permanently:
  // the rows are inactive by the time this returns, so no later pass can find
  // them to correct it. The DELETE route looks like a per-candidate precedent
  // only because it handles exactly one endorsement per call.
  for (const e of misaligned) {
    const candidate = candidateById.get(e.candidateId.toString());
    // NPP candidates never received a landing bump (applySupportDelta is keyed
    // by characterId), so their revocation stays a no-op too.
    if (!candidate || candidate.isNPP || !candidate.characterId) continue;
    await applyEndorsementSupportBump(db, candidate.characterId, true);
  }

  await db
    .collection<PlayerEndorsement>("playerEndorsements")
    .updateMany(
      { _id: { $in: misaligned.map((e) => e._id) } },
      { $set: { isActive: false, withdrawnAt: now } }
    );

  return misaligned.length;
}

/**
 * Withdraw a character's active player endorsements that violate primary-phase
 * party alignment after their membership moved to `newParty`. Called from every
 * party-transition seam (join / leave / purge / relocation / ban strip /
 * charter ratification) right after the membership write.
 *
 * Returns the number of endorsements withdrawn.
 */
export async function withdrawPlayerEndorsementsOnPartyChange(
  db: Db,
  characterId: ObjectId,
  newParty: string,
  clock: EndorsementPhaseClock
): Promise<number> {
  const active = await db
    .collection<PlayerEndorsement>("playerEndorsements")
    .find({ characterId, isActive: true })
    .toArray();
  if (active.length === 0) return 0;

  return withdrawPrimaryMisalignedRows(
    {
      db,
      // Callers without a turn counter fall back to the Date comparison inside
      // isPrimaryPhaseOpen; the hourly sweep below re-checks with the real turn.
      currentTurn: clock.currentTurn,
      now: clock.now,
    },
    active,
    new Map([[characterId.toString(), newParty]])
  );
}

/**
 * Turn-phase sweep: heal active player endorsements whose endorser's CURRENT
 * party no longer matches the endorsed candidate's party while the race's
 * primary is still open. Catches rows written before the transition hooks
 * existed and membership changes made outside those seams. Must run BEFORE
 * processCampaignTurn so withdrawals stop this very turn's action grant.
 */
export async function sweepPartyMismatchedPlayerEndorsements(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<number> {
  const active = await db
    .collection<PlayerEndorsement>("playerEndorsements")
    .find({ isActive: true })
    .toArray();
  if (active.length === 0) return 0;

  const withdrawn = await withdrawPrimaryMisalignedRows({ db, currentTurn, now }, active);
  if (withdrawn > 0) {
    console.log(
      `[Turn] sweepPartyMismatchedPlayerEndorsements: withdrew ${withdrawn} party-misaligned endorsement(s)`
    );
  }
  return withdrawn;
}
