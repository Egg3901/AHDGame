import { ObjectId, type Db } from "mongodb";
import type { Character, Election, ElectionCandidate } from "@/lib/db/types";
import { getDebateSessionsCollection } from "@/lib/db/collections/debateSessions";
import { seededRoll, makeSeededRng } from "@/lib/events/substrate/rng";
import { isInPrimaryPhase } from "@/lib/elections/electionDeadlineFilters";
import { DEBATE_CHALLENGE_CHANCE, DEBATE_MAX_PER_ELECTION } from "./debateScoring";
import {
  buildCharacterParticipant,
  buildNppParticipant,
  createDebateChallenge,
  sweepExpiredDebates,
} from "./debateSessionLifecycle";

const CHALLENGE_THRESHOLD = Math.round(DEBATE_CHALLENGE_CHANCE * 100);

export interface DebateChallengeResult {
  created: number;
  /** Characters now bound to an active debate this pass — the offer loop skips them. */
  participantCharacterIds: Set<string>;
}

/**
 * Per-turn debate driver: resolve overdue debates, then for each player candidate
 * not already debating, roll the challenge chance and pair them with a random
 * co-candidate (player or NPP). Deterministic for replay (seeded rolls).
 */
export async function processDebateChallenges(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<DebateChallengeResult> {
  const sessions = getDebateSessionsCollection(db);

  // 1. Resolve debates past their deadline (seeded rng for replay safety).
  await sweepExpiredDebates(db, now, makeSeededRng(`debate-sweep:${currentTurn}`));

  // 2. Characters already in an awaiting debate are off-limits.
  const active = await sessions.find({ status: "awaitingStrategies" }).toArray();
  const consumed = new Set<string>();
  for (const s of active) {
    if (s.challenger.characterId) consumed.add(s.challenger.characterId.toString());
    if (s.opponent.characterId) consumed.add(s.opponent.characterId.toString());
  }

  // 3. Active candidacies grouped by election.
  const candidacies = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ status: "active" })
    .toArray();
  const byElection = new Map<string, ElectionCandidate[]>();
  for (const c of candidacies) {
    const key = c.electionId.toString();
    (byElection.get(key) ?? byElection.set(key, []).get(key)!).push(c);
  }

  // Phase lookup: during a primary, every party's contenders share one election
  // and are all "active", so an unrestricted pairing can pit a player against a
  // rival party's primary candidate (a debate the player isn't actually in). In
  // the primary phase opponents must share the challenger's party; the general
  // phase is intentionally cross-party (challenger vs the other nominee).
  const electionIds = [...byElection.keys()].map((id) => new ObjectId(id));
  const elections =
    electionIds.length > 0
      ? await db
          .collection<Election>("elections")
          .find(
            { _id: { $in: electionIds } },
            { projection: { _id: 1, primaryEndTurn: 1, primaryEndTime: 1 } }
          )
          .toArray()
      : [];
  const primaryPhaseByElection = new Map(
    elections.map((e) => [e._id.toString(), isInPrimaryPhase(e, currentTurn, now)])
  );

  // Per-election debate tally (counting a candidate as challenger OR opponent,
  // across awaiting + resolved sessions) so no candidate exceeds
  // DEBATE_MAX_PER_ELECTION debates in a single race — debates auto-spawn each
  // turn, so this is the ceiling that stops favorability-farming vs NPPs.
  const debateCounts = new Map<string, number>();
  if (electionIds.length > 0) {
    const priorSessions = await sessions
      .find(
        { electionId: { $in: electionIds }, status: { $in: ["awaitingStrategies", "resolved"] } },
        { projection: { electionId: 1, "challenger.characterId": 1, "opponent.characterId": 1 } }
      )
      .toArray();
    for (const s of priorSessions) {
      const ek = s.electionId.toString();
      for (const cidObj of [s.challenger.characterId, s.opponent.characterId]) {
        if (!cidObj) continue;
        const k = `${ek}:${cidObj.toString()}`;
        debateCounts.set(k, (debateCounts.get(k) ?? 0) + 1);
      }
    }
  }
  const atCap = (electionKey: string, characterId: string): boolean =>
    (debateCounts.get(`${electionKey}:${characterId}`) ?? 0) >= DEBATE_MAX_PER_ELECTION;
  const bumpCount = (electionKey: string, characterId: string): void => {
    const k = `${electionKey}:${characterId}`;
    debateCounts.set(k, (debateCounts.get(k) ?? 0) + 1);
  };

  // 4. Load player candidate docs (every human gets the interactive side).
  const playerCandIds = candidacies
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => c.characterId!);
  const chars =
    playerCandIds.length > 0
      ? await db
          .collection<Character>("characters")
          .find(
            { _id: { $in: playerCandIds } },
            {
              projection: {
                _id: 1,
                name: 1,
                stats: 1,
                careerHistory: 1,
                currentOffice: 1,
                countryId: 1,
              },
            }
          )
          .toArray()
      : [];
  const charById = new Map(chars.map((c) => [c._id.toString(), c]));

  let created = 0;
  for (const [electionKey, cands] of byElection) {
    if (cands.length < 2) continue;
    const primaryPhase = primaryPhaseByElection.get(electionKey) ?? false;
    for (const cand of cands) {
      if (cand.isNPP || !cand.characterId) continue; // only players are prompted
      const cid = cand.characterId.toString();
      if (consumed.has(cid)) continue;
      if (atCap(electionKey, cid)) continue; // hit the per-election debate ceiling
      const char = charById.get(cid);
      if (!char) continue;

      // 50% seeded challenge roll.
      if (
        seededRoll(cand.characterId.toHexString(), currentTurn, "debate", "challenge") >
        CHALLENGE_THRESHOLD
      ) {
        continue;
      }

      // Pick a still-available co-candidate as the opponent. In the primary
      // phase, restrict to the challenger's own party — cross-party pairings are
      // only valid once the general phase narrows each side to one nominee.
      const opponents = cands.filter(
        (o) =>
          o !== cand &&
          !(o.characterId && consumed.has(o.characterId.toString())) &&
          // Don't pull a player opponent past their own per-election ceiling.
          // NPP opponents (no characterId) aren't capped — the challenger cap
          // already bounds how often a player can farm them.
          !(o.characterId && !o.isNPP && atCap(electionKey, o.characterId.toString())) &&
          (!primaryPhase || o.party === cand.party)
      );
      if (opponents.length === 0) continue;
      const oppIndex =
        seededRoll(cand.characterId.toHexString(), currentTurn, "debate", "opponent") %
        opponents.length;
      const pick = opponents[oppIndex];

      const challenger = buildCharacterParticipant(char);
      let opponent;
      if (!pick.isNPP && pick.characterId) {
        const oppChar = charById.get(pick.characterId.toString());
        if (!oppChar) continue;
        opponent = buildCharacterParticipant(oppChar);
      } else if (pick.nppId) {
        opponent = buildNppParticipant({ _id: pick.nppId, name: pick.characterName });
      } else {
        continue;
      }

      await createDebateChallenge(db, {
        electionId: cand.electionId,
        countryId: char.countryId,
        challenger,
        opponent,
        currentTurn,
        now,
      });
      created++;
      consumed.add(cid);
      bumpCount(electionKey, cid);
      if (opponent.characterId) {
        consumed.add(opponent.characterId.toString());
        if (opponent.kind === "character") bumpCount(electionKey, opponent.characterId.toString());
      }
    }
  }

  return { created, participantCharacterIds: consumed };
}
