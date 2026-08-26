/**
 * The German Question follows the shooting.
 *
 * A war declared BY or AGAINST one of the two Germanies, against the opposing
 * bloc, ends the influence contest the same way the crisis's own declaration
 * does: the board freezes where it stands and whoever wins the war takes the
 * settlement outright. Without this the two systems are fully decoupled — the
 * United States could declare on East Germany and the crisis would keep ticking
 * plays and drift, resolving on the index while the blocs shot at each other
 * over the very question being played.
 *
 * A SWEEP, not a hook inside `declareWar`, for exactly the reason
 * `settleFromConflict` gives: the military engine is shared with the proxy-war
 * path and reaching into it to special-case one crisis would put settlement
 * logic inside the war engine. This reads the live conflicts every tick and
 * needs the military side to know nothing about it. The cost is up to one turn
 * of latency between ratification and the freeze.
 *
 * WHY `treatyEntries` IS THE TEST FOR "DECLARED". A country reaches a roster
 * three ways: it declared, it was declared on, or a collective-defence charter
 * dragged it in. `treatyEntries` is written by, and only by, the charter path
 * (see `declareWar.ts`), so roster-membership-minus-`treatyEntries` is an exact
 * reading of "declarer or declared-on" that needs no new field. An East Germany
 * pulled into a war over Poland therefore does not settle the German Question;
 * an East Germany someone declared war on does.
 */
import type { Db, Filter } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type {
  SettlementConflictAttachment,
  SettlementConflictSides,
  SettlementCrisisDoc,
  SettlementGermanAnchor,
} from "@/lib/db/types/settlementCrisis";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { blocOf, type BlocLookup } from "@/lib/military/bloc";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { hostEntitiesOf } from "@/lib/military/hostEntities";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import {
  GERMAN_QUESTION_CHALLENGER,
  GERMAN_QUESTION_TARGET,
} from "@/lib/constants/settlementCrisis";

/** What an attached war is renamed to. Player-facing: no dashes. */
export const WAR_FOR_GERMANY_NAME = "The War for Germany";

/** Both Germanies, in the order a widened host roster lists them. */
const GERMANIES: readonly SettlementGermanAnchor[] = [
  GERMAN_QUESTION_TARGET,
  GERMAN_QUESTION_CHALLENGER,
];

type WarSide = "A" | "B";

export interface QualifyingWar {
  conflictId: string;
  /** The Germany whose belligerency anchored the attachment. */
  anchor: SettlementGermanAnchor;
  sides: SettlementConflictSides;
}

/** The conflict fields the qualification test reads. Kept narrow so it stays pure. */
type QualifyInput = Pick<ConflictDoc, "_id" | "type" | "sideA" | "sideB"> &
  Partial<Pick<ConflictDoc, "treatyEntries">>;

const other = (side: WarSide): WarSide => (side === "A" ? "B" : "A");

/**
 * Which roster a country is ON.
 *
 * Deliberately NOT `sideOf` from `occupation.ts`. That resolver falls back to
 * matching a country's bloc against the sides' backers, which is right for
 * "whose ground does this unit take" and wrong here: a bloc rival who never
 * declared anything would be read as a belligerent, and every NATO member would
 * qualify as having declared on East Germany the moment Washington did.
 */
function rosterSideOf(c: QualifyInput, countryId: string): WarSide | null {
  if (rosterFor(c, "A").includes(countryId)) return "A";
  if (rosterFor(c, "B").includes(countryId)) return "B";
  return null;
}

/** Did a collective-defence charter put this country here, rather than a declaration? */
function draggedIn(c: QualifyInput, countryId: string): boolean {
  return (c.treatyEntries ?? []).some((e) => e.countryId === countryId);
}

/**
 * One side's roster.
 *
 * `?? []` is not defensiveness for its own sake: this reads conflict documents
 * this feature does not own, including seeded and admin-created ones, and a
 * throw here is swallowed by `runPhase` as a failed phase — which would take the
 * German Question offline every turn, silently, for one malformed war.
 */
function rosterFor(c: QualifyInput, side: WarSide): string[] {
  return ((side === "A" ? c.sideA?.countries : c.sideB?.countries) ?? []) as string[];
}

/**
 * Does this war settle the German Question by force, and which way round?
 *
 * Pure, so every clause is testable without a database. Null means "not this
 * war" — the crisis keeps playing.
 */
export function qualifyWar(c: QualifyInput, blocs: BlocLookup): QualifyingWar | null {
  // DECLARED WARS ONLY. `interstate` is what `declareWar` creates, and a
  // declaration is the whole premise of this rule.
  //
  // A `cold_war` proxy war would otherwise qualify the moment two rosters filled
  // out: its sides start as FACTIONS with backers, but `joinSide` puts real
  // countries on them when players intervene. East Germany sending troops to
  // somebody else's proxy war on the far side of the world is not a war declared
  // by or against a Germany, and must not settle the German Question.
  if (c.type !== "interstate") return null;

  const challengerSide = rosterSideOf(c, GERMAN_QUESTION_CHALLENGER);
  const targetSide = rosterSideOf(c, GERMAN_QUESTION_TARGET);

  // Both Germanies on ONE roster has no honest mapping: the war cannot decide a
  // question whose two answers are fighting the same enemy. Refuse rather than
  // pick one, and leave the board in play.
  if (challengerSide !== null && challengerSide === targetSide) return null;

  // East Germany anchors when it can, because it is the challenger the outcome
  // is named for; West Germany is the fallback when only it is a belligerent.
  const anchor: SettlementGermanAnchor | null =
    challengerSide !== null && !draggedIn(c, GERMAN_QUESTION_CHALLENGER)
      ? GERMAN_QUESTION_CHALLENGER
      : targetSide !== null && !draggedIn(c, GERMAN_QUESTION_TARGET)
        ? GERMAN_QUESTION_TARGET
        : null;
  if (anchor === null) return null;

  const anchorSide = (
    anchor === GERMAN_QUESTION_CHALLENGER ? challengerSide : targetSide
  ) as WarSide;
  const opposingSide = other(anchorSide);

  // The war must be bloc against bloc. A Germany that sits in no alliance is not
  // "one side" of the Cold War, and a war against a non-aligned state settles
  // nothing between Washington and Moscow.
  const anchorBloc = blocOf(blocs, anchor);
  if (anchorBloc === "nonAligned") return null;
  const opposedByRival = rosterFor(c, opposingSide).some((id) => {
    const bloc = blocOf(blocs, id);
    return bloc !== "nonAligned" && bloc !== anchorBloc;
  });
  if (!opposedByRival) return null;

  const challenger = anchor === GERMAN_QUESTION_CHALLENGER ? anchorSide : opposingSide;
  return {
    conflictId: c._id,
    anchor,
    sides: { challenger, incumbent: other(challenger) },
  };
}

export interface AttachResult {
  attached: boolean;
  conflictId: string | null;
}

const NOT_ATTACHED: AttachResult = { attached: false, conflictId: null };

/**
 * The war's own hosts plus both Germanies, deduped, its anchor kept first.
 *
 * `filter(Boolean)` for the same reason `rosterFor` defaults to `[]`: on a
 * conflict with no `hostCountry`, `hostEntitiesOf` yields `[undefined]`, and
 * writing that back would put a junk entry into a real war's host roster.
 */
function widenHosts(c: ConflictDoc): WorldEntityId[] {
  const hosts = hostEntitiesOf(c).filter(Boolean);
  for (const germany of GERMANIES) {
    if (!hosts.includes(germany)) hosts.push(germany);
  }
  return hosts;
}

/**
 * Freeze an open crisis onto a qualifying live war, if there is one.
 *
 * ORDER: claim the freeze FIRST, then rename and widen the war — the same
 * ordering `declareSettlementWar` uses, and for the same reason. A failure after
 * the claim leaves the crisis correctly frozen on a war that merely kept its own
 * name, which is recoverable; the reverse would rename a war no crisis points at.
 */
export async function attachCrisisToLiveWar(
  db: Db,
  crisis: SettlementCrisisDoc
): Promise<AttachResult> {
  if (crisis.status !== "open") return NOT_ATTACHED;

  const conflicts = getConflictsCollection(db);
  const candidates = await conflicts
    .find({
      // Mirrors `qualifyWar`'s own gate; that one is authoritative, this one just
      // keeps proxy wars out of the result set.
      type: "interstate",
      status: { $ne: "resolved" },
      $or: [{ "sideA.countries": { $in: GERMANIES } }, { "sideB.countries": { $in: GERMANIES } }],
    } as Filter<ConflictDoc>)
    .toArray();
  if (candidates.length === 0) return NOT_ATTACHED;

  // One read for the whole sweep, and only once a candidate exists.
  const blocs = await loadMilitaryBlocs(db);
  // Oldest first, so two qualifying wars resolve to the same one on every tick
  // and on a replay. Sorted here rather than in the query because the sort is
  // over a handful of documents and this keeps the cursor untouched.
  const ordered = [...candidates].sort((a, b) => (a.startTurn ?? 0) - (b.startTurn ?? 0));

  let war: ConflictDoc | null = null;
  let qualified: QualifyingWar | null = null;
  for (const candidate of ordered) {
    const q = qualifyWar(candidate, blocs);
    if (q) {
      war = candidate;
      qualified = q;
      break;
    }
  }
  if (!war || !qualified) return NOT_ATTACHED;

  // Absent and empty both mean "just the anchor" to `hostEntitiesOf`, so both are
  // stored as null and restored by unsetting the field.
  const previousHostEntities =
    war.hostEntities && war.hostEntities.length > 0 ? war.hostEntities : null;
  // NULL WHEN THE WAR ALREADY CARRIES THE SETTLEMENT'S NAME, so re-attaching can
  // never record the sentinel as the war's "own" name. Without this, a crash
  // between the two writes below leaves the war renamed and the crisis open, and
  // the next attach would store "The War for Germany" as what to restore —
  // losing the real name for good.
  const previousName = war.name === WAR_FOR_GERMANY_NAME ? null : war.name;

  const crises = await getSettlementCrisesCollection(db);
  const claimed = await crises.updateOne(
    { _id: crisis._id, status: "open" },
    {
      $set: {
        status: "frozen",
        conflictId: qualified.conflictId,
        conflictSides: qualified.sides,
        conflictAttachment: {
          anchor: qualified.anchor,
          previousName,
          previousHostEntities,
        },
        updatedAt: new Date(),
      },
    }
  );
  if (claimed.matchedCount !== 1) return NOT_ATTACHED;

  await conflicts.updateOne(
    { _id: war._id },
    { $set: { name: WAR_FOR_GERMANY_NAME, hostEntities: widenHosts(war) } }
  );

  return { attached: true, conflictId: qualified.conflictId };
}

export interface DetachResult {
  detached: boolean;
}

const NOT_DETACHED: DetachResult = { detached: false };

/**
 * Give a crisis back to the board when the war it attached to stops being about
 * Germany.
 *
 * A belligerent can leave a war on a separate peace while the fighting carries
 * on between the others. Without this, an East Germany that made peace on turn
 * three would still have the question decided three hundred turns later by a war
 * fought between two other countries — a worse version of the case the
 * `treatyEntries` test exists to exclude.
 *
 * Only ever applies to a crisis that ATTACHED itself. A crisis frozen by its own
 * declaration carries no `conflictAttachment`, and for it the war IS the crisis:
 * it stays frozen and settles on the result.
 */
export async function detachCrisisFromWar(
  db: Db,
  crisis: SettlementCrisisDoc
): Promise<DetachResult> {
  const attachment = crisis.conflictAttachment;
  if (crisis.status !== "frozen" || !crisis.conflictId || !attachment) return NOT_DETACHED;

  const conflicts = getConflictsCollection(db);
  const war = await conflicts.findOne({ _id: crisis.conflictId });
  // A vanished war is an admin problem, and a finished one belongs to
  // `settleFrozenCrisisFromConflict` — which settles on the stamped sides
  // whether or not the anchor was still standing at the end.
  if (!war || war.status === "resolved") return NOT_DETACHED;
  if (rosterSideOf(war, attachment.anchor) !== null) return NOT_DETACHED;

  // RESTORE FIRST, release second — the OPPOSITE order to `attachCrisisToLiveWar`,
  // and deliberately so. Both orders err the same way: never leave the settlement's
  // marks on a war that no question points at.
  //
  // Releasing first would make a crash in between permanent: the crisis is back on
  // the board, the attachment stamp that says what to give back is gone, and the
  // war keeps a name and a host roster nothing will ever undo. This way round a
  // crash leaves the crisis still frozen with its stamp intact, and the next tick
  // simply detaches again — the restore is idempotent, so replaying it costs
  // nothing.
  await restoreAttachedWar(db, war._id, attachment);

  const crises = await getSettlementCrisesCollection(db);
  const released = await crises.updateOne(
    { _id: crisis._id, status: "frozen" },
    {
      $set: {
        status: "open",
        conflictId: null,
        conflictSides: null,
        conflictAttachment: null,
        updatedAt: new Date(),
      },
      // The stamp is what makes a one-off dispatch fire once, and until detach
      // existed a crisis could never leave `frozen` — so "war" was posted at most
      // once per crisis by construction. It can now go to war a SECOND time, and
      // that one has to be announced too.
      $pull: { postedWireEvents: "war" },
    }
  );
  // Restoring a war whose crisis then refused to release is harmless: the stamp
  // still records the same name, and the next detach writes it again.
  if (released.matchedCount !== 1) return NOT_DETACHED;

  return { detached: true };
}

/**
 * End an attachment: give the war back its identity, then drop the stamp.
 *
 * For the paths that take a crisis OUT of play without the war deciding it —
 * closing the question, and forcing its outcome from the admin panel. Both leave
 * the war running, and neither should leave it named "The War for Germany",
 * carrying a Germany it was never fought over, with no question pointing at it.
 *
 * A no-op, returning false, for a crisis frozen by its OWN declaration: that war
 * carries no attachment, was created under this name, and has nothing to give back.
 *
 * Call it AFTER whatever claim decides the crisis really is leaving play, so a
 * request that lost its race does not strip a war another one still owns.
 */
export async function endWarAttachment(
  db: Db,
  crisis: Pick<SettlementCrisisDoc, "_id" | "conflictId" | "conflictAttachment">
): Promise<boolean> {
  if (!crisis.conflictAttachment || !crisis.conflictId) return false;

  await restoreAttachedWar(db, crisis.conflictId, crisis.conflictAttachment);
  // Cleared second, and only after the war is actually back: the stamp is the
  // record of what is still owed, so dropping it first would strand the marks.
  const crises = await getSettlementCrisesCollection(db);
  await crises.updateOne({ _id: crisis._id }, { $set: { conflictAttachment: null } });
  return true;
}

/**
 * Put an attached war back the way the sweep found it. Idempotent, so replaying
 * it after a crash costs nothing.
 */
export async function restoreAttachedWar(
  db: Db,
  conflictId: string,
  attachment: SettlementConflictAttachment
): Promise<void> {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};

  // Null means the sweep found the war already carrying this name and did not
  // rename it, so it has no name of its own to be given back.
  if (attachment.previousName !== null) set.name = attachment.previousName;
  if (attachment.previousHostEntities) set.hostEntities = attachment.previousHostEntities;
  else unset.hostEntities = "";

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  if (Object.keys(update).length === 0) return;

  await getConflictsCollection(db).updateOne({ _id: conflictId }, update);
}
