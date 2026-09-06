import type { Db, ObjectId } from "mongodb";
import type { Election, ElectionCandidate } from "@/lib/db/types";
import { computeElectionPhase } from "@/lib/elections/phases";
import type { GameTimeContext } from "@/lib/time/gameTime";

export interface OppositionTarget {
  /** characters._id (or npps._id), which is what the retarget route takes. */
  id: string;
  name: string;
  /** Party label, so a general-election list can be read at a glance. */
  party: string | null;
}

/**
 * Who a campaign may put opposition research on.
 *
 * The rule is the race, not the country. Before this, the picker searched every
 * character in the game and the server checked only that the target existed and
 * shared a country, so research could be bought against a private citizen or a
 * senator who was not running — 8 actions and $40,000 spent to drain the
 * favourability of somebody the buyer was not standing against.
 *
 * Scoped by phase, because "opponent" means different people in each:
 *
 *  - **Primary.** The other candidates in the buyer's OWN party field. A rival
 *    in the other party's primary is not competing with the buyer for a single
 *    delegate, so draining them would be a purchase with no effect on the race
 *    the buyer is in — the same undetectable-spend shape that got turnout
 *    suppression pulled.
 *  - **General.** Every other ticket, which is by then the whole field.
 *
 * Exported as one function so the picker and the route's validation cannot
 * disagree about who is fair game: a list the UI offers but the server refuses
 * is a button that fails, and a target the server allows but the UI hides is a
 * mechanic nobody finds.
 */
export async function loadOppositionTargets(
  db: Db,
  election: Pick<
    Election,
    | "_id"
    | "startTime"
    | "primaryEndTime"
    | "endTime"
    | "status"
    | "startTurn"
    | "primaryEndTurn"
    | "endTurn"
  >,
  selfCharacterId: ObjectId | null,
  /**
   * Passed in rather than fetched. Both callers already hold one, and reaching
   * for the module-level clock here would open a second database connection
   * inside a helper that otherwise only reads what it is given — which is also
   * what made it impossible to exercise outside the app.
   */
  gameTime: GameTimeContext
): Promise<OppositionTarget[]> {
  const phase = computeElectionPhase(
    election.startTime ?? null,
    election.primaryEndTime ?? null,
    election.endTime ?? null,
    election.status,
    gameTime,
    {
      startTurn: election.startTurn ?? null,
      primaryEndTurn: election.primaryEndTurn ?? null,
      endTurn: election.endTurn ?? null,
    }
  );

  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ electionId: election._id, status: "active" })
    .toArray();

  const self = selfCharacterId
    ? candidates.find((c) => c.characterId?.toString() === selfCharacterId.toString())
    : undefined;

  const inMyField = (c: ElectionCandidate) =>
    // A presidential election holds every party's primary field at once, so
    // "the field" during a primary is the buyer's own party's slice of it.
    phase.inPrimary && self ? String(c.party) === String(self.party) : true;

  return candidates
    .filter((c) => c.characterId?.toString() !== selfCharacterId?.toString())
    .filter(inMyField)
    .map((c) => ({
      id: c.characterId?.toString() ?? "",
      name: c.characterName ?? "Unknown",
      party: c.party ?? null,
    }))
    .filter((t) => t.id !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
}
