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
type QualifyInput = Pick<ConflictDoc, "_id" | "sideA" | "sideB"> &
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
  if ((c.sideA.countries as string[]).includes(countryId)) return "A";
  if ((c.sideB.countries as string[]).includes(countryId)) return "B";
  return null;
}

/** Did a collective-defence charter put this country here, rather than a declaration? */
function draggedIn(c: QualifyInput, countryId: string): boolean {
  return (c.treatyEntries ?? []).some((e) => e.countryId === countryId);
}

function rosterFor(c: QualifyInput, side: WarSide): string[] {
  return (side === "A" ? c.sideA.countries : c.sideB.countries) as string[];
}

/**
 * Does this war settle the German Question by force, and which way round?
 *
 * Pure, so every clause is testable without a database. Null means "not this
 * war" — the crisis keeps playing.
 */
export function qualifyWar(c: QualifyInput, blocs: BlocLookup): QualifyingWar | null {
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

/** The war's own hosts plus both Germanies, deduped, its anchor kept first. */
function widenHosts(c: ConflictDoc): WorldEntityId[] {
  const hosts = [...hostEntitiesOf(c)];
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
          previousName: war.name,
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
    }
  );
  if (released.matchedCount !== 1) return NOT_DETACHED;

  await conflicts.updateOne(
    { _id: war._id },
    attachment.previousHostEntities
      ? {
          $set: {
            name: attachment.previousName,
            hostEntities: attachment.previousHostEntities,
          },
        }
      : { $set: { name: attachment.previousName }, $unset: { hostEntities: "" } }
  );

  return { detached: true };
}
