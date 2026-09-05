import type { ObjectId } from "mongodb";

/**
 * One act taken against a named rival in a named state during a presidential
 * primary.
 *
 * A collection rather than fields on the target's candidate row: fields cannot
 * hold many attackers against many targets in many states, carry no expiry, and
 * are the shape that produced the dead home-state surge, where a route wrote
 * `primarySurgeBoost` and nothing ever read it. Rows are also an audit trail,
 * which matters when the act is against another player.
 */
/**
 * A third kind, `turnoutSuppression`, was built and then pulled before release:
 * it took points off one demographic group's turnout in one state, for every
 * candidate there including the buyer. Simulated across 2- to 5-candidate
 * fields it moved the delegate count by 0.00pp at every price tested, because
 * no group is concentrated enough behind one candidate for a symmetric cut to
 * favour anyone. Restoring it needs the demographic spread to be sharper
 * first, not a bigger number.
 */
export type PrimaryStateActionKind = "localFavorability" | "voteSuppression";

export interface PrimaryStateAction {
  _id: ObjectId;
  electionId: ObjectId;
  /** electionCandidates._id of the candidate who acted. */
  actorCandidateId: ObjectId;
  /**
   * electionCandidates._id of the candidate acted against. Phase 2 matches the
   * projection on this, which is keyed by candidate row.
   */
  targetCandidateId: ObjectId;
  /**
   * characters._id (or npps._id) for the same target.
   *
   * Both ids are stored because the engine needs a different one in each place,
   * and they are NOT interchangeable: `campaignTurn`'s favourability map is
   * keyed by character/NPP id and resolved against those collections, while the
   * primary projection is keyed by candidate row. Storing only the row id would
   * charge the player and move nobody's favourability, which is the shape of
   * the dead home-state surge.
   */
  targetCharacterId: ObjectId;
  stateId: string;
  kind: PrimaryStateActionKind;
  /** Effect size at purchase, so retuning a constant does not rewrite history. */
  magnitude: number;
  /** Fraction the target's shield absorbed, 0..1, stamped at purchase. */
  shieldApplied: number;
  /**
   * The demographic group an action names, for kinds that target one. No
   * shipped kind does; kept because rows are an audit trail and the field costs
   * nothing to carry.
   */
  bucket?: string;
  appliedTurn: number;
  /** Exclusive: the engine ignores rows at or past this turn. */
  expiresTurn: number;
  createdAt: Date;
}
