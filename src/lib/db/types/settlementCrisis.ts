import type { ObjectId } from "mongodb";
import type { SettlementRules } from "@/lib/constants/settlementCrisis";

/**
 * A settlement crisis: a standing contest over one nation's constitutional
 * settlement, fought across several weighted institutions rather than on a
 * single meter.
 *
 * POSITIONS ARE INTEGER HUNDREDTHS, 0-10000. Same reasoning as
 * `src/lib/alignment/normalize.ts`: the index is a weighted mean of the
 * institutions, and on a float grid that mean drifts away from the cards it is
 * derived from. Integers make it exact; the division to points happens once, at
 * render.
 */
export type SettlementInstitutionId = "bundestag" | "laender" | "street" | "garrison";
export type SettlementSeatId = "US" | "UK" | "RU" | "DD";
/**
 * `cancelled` is a crisis an admin closed without deciding it — see
 * `closeSettlementCrisis`. It is terminal and inert: every sweep and every read
 * in this feature filters POSITIVELY on `open`, `frozen` or `resolved`, so a
 * cancelled document is picked up by nothing. That is what makes closing behave
 * as though the question was never asked while the record survives.
 */
export type SettlementStatus = "open" | "frozen" | "resolved" | "cancelled";
export type SettlementOutcome = "incumbent" | "challenger";

/** Which of the two Germanies a war's attachment is anchored on. */
export type SettlementGermanAnchor = "DE" | "DD";

/**
 * Which conflict roster carries which settlement outcome.
 *
 * Stamped when the crisis freezes, NOT derived when the war ends. A
 * player-declared war carries no `backer` on either side — only this crisis's
 * own declaration and the admin proxy-war route set that field — so reading the
 * winner's bloc at resolution time would leave an attached crisis frozen for
 * ever. Stamping also survives a roster or a bloc membership changing mid-war,
 * which a live read would silently follow.
 */
export interface SettlementConflictSides {
  /** The roster whose victory reunifies Germany under the East. */
  challenger: "A" | "B";
  /** The roster whose victory keeps West Germany sovereign. */
  incumbent: "A" | "B";
}

/**
 * Bookkeeping for a crisis that ATTACHED itself to a war it did not start.
 *
 * Absent on a crisis frozen by its own `declare` press, and that absence is what
 * `detachCrisisFromWar` reads: the crisis's own war is the crisis, and never
 * detaches. The two `previous*` fields exist so a detach can put the conflict
 * record back the way it found it.
 */
export interface SettlementConflictAttachment {
  /** The Germany whose belligerency anchored the attachment. */
  anchor: SettlementGermanAnchor;
  /**
   * The war's name before the attachment renamed it.
   *
   * Null means the sweep found it ALREADY carrying the settlement's name and did
   * not rename it, so there is nothing of its own to restore. That case only
   * arises after a crash between the freeze and the rename, and the null is what
   * stops the next attachment recording the sentinel as the war's real name.
   */
  previousName: string | null;
  /** Its `hostEntities` before widening. Null when the field was absent or empty. */
  previousHostEntities: string[] | null;
}

export interface SettlementInstitutionState {
  id: SettlementInstitutionId;
  /** Relative pull on the index. Weights across all institutions sum to 10. */
  weight: number;
  /** Hundredths toward the challenger, 0-10000. */
  position: number;
  lastPlay: { seatId: SettlementSeatId | null; label: string; turn: number } | null;
  /** This tick's drift roll in hundredths, signed. */
  lastDrift: number;
}

export interface SettlementSeatState {
  id: SettlementSeatId;
  /** Banked capital, whole points, 0..SEAT_CAPITAL_CAP. */
  capital: number;
  /**
   * BANKED action points, ready to spend.
   *
   * A pool, not a per-turn allowance, and shaped exactly like `capital`: the
   * tick adds `actionsPerTurn` and clamps at a ceiling. Four of the authored
   * seat plays cost more AP than their seat earns in a turn — Moscow's only
   * lever on the garrison is one of them — so without banking they are
   * unplayable and 60% of the board's weight has no Eastern lever at all. The
   * source design says as much: "a secondary seat must bank AP across turns to
   * afford a 2 AP play".
   */
  actions: number;
  lastActedTurn: number | null;
  /** Cumulative |appliedPoints| in hundredths — the delegation bench figure. */
  committedPoints: number;
}

export interface SettlementCrisisDoc {
  _id: ObjectId;
  kind: "settlement.germanQuestion";
  status: SettlementStatus;
  /** Whose settlement is at stake. Unplayable; acts only through drift. */
  targetEntityId: string;
  /** Who absorbs the target on a challenger win. */
  challengerEntityId: string;
  /**
   * DERIVED — the weight-normalised mean of `institutions[].position`, in
   * hundredths. Never written directly; `recomputePosition` owns it.
   */
  position: number;
  institutions: SettlementInstitutionState[];
  seats: SettlementSeatState[];
  /**
   * `quietTurns` is consecutive ticks with no coercive play, and it is what
   * paces decay — a rung is lost only every `LADDER_DECAY_TURNS` of them.
   * Optional because crises written before the counter existed have no field;
   * read it as `?? 0`.
   */
  ladder: { heat: number; armedTurn: number | null; quietTurns?: number };
  /**
   * The three admin rule switches from the source design.
   *
   * Optional, and read through `settlementRulesFor` rather than directly: a
   * crisis inserted before this field existed must keep the authored defaults
   * rather than reading three `undefined`s as "off".
   */
  rules?: SettlementRules;
  /** Weighted drift applied per tick, newest first, capped at 6 entries. */
  driftHistory: number[];
  /**
   * Last turn the settlement phase ticked this crisis.
   *
   * The phase claims on this before doing anything, so two overlapping turn
   * runs — which this project has had, from rolling deploys — cannot both tick
   * it. Without the claim the loser computes a drift-only result from the same
   * snapshot and overwrites the winner's write, silently discarding every play
   * that landed that turn.
   */
  lastTickedTurn: number | null;
  /**
   * Set when a declared war freezes the crisis.
   *
   * Two roads reach it. The crisis's own `declare` press creates "The War for
   * Germany" and points at it; or a war declared by or against one of the
   * Germanies against the opposing bloc is ATTACHED by the turn phase, in which
   * case `conflictAttachment` is stamped too. Either way the war decides the
   * settlement outright and the index is not consulted.
   */
  conflictId: string | null;
  /**
   * Which roster wins the settlement for whom. Optional because crises frozen
   * before this field existed have none; `settleFromConflict` falls back to the
   * sides' `backer` for those.
   */
  conflictSides?: SettlementConflictSides | null;
  /** Present only on an ATTACHED crisis. See `SettlementConflictAttachment`. */
  conflictAttachment?: SettlementConflictAttachment | null;
  openedTurn: number;
  /**
   * The turn the crisis left play — decided OR cancelled. `outcome` is what
   * says which: a cancelled crisis has a turn here and a null outcome.
   */
  resolvedTurn: number | null;
  /**
   * Cadence stamp for the World News sentiment briefing: when the last one went
   * out and where the index stood then, which is what the next one reports the
   * swing against.
   */
  lastBriefing?: { turn: number; position: number } | null;
  /**
   * One-off wire moments already posted for this crisis. The stamp, not the
   * status, is what makes each post exactly once — a crisis can sit armed for
   * many turns, and the tick sees that state on every one of them.
   */
  postedWireEvents?: string[];
  outcome: SettlementOutcome | null;
  cooldownUntilTurn: number | null;
  createdAt: Date;
  updatedAt: Date;
}
