/**
 * Opening the German Question.
 *
 * ADMIN-STARTED ONLY. Nothing in the turn loop opens a settlement crisis: an
 * operator decides when the question is asked, from the admin surface, and it
 * may be asked at any point in a world's life. There is no era window and no
 * re-open cooldown gating the start.
 *
 * Two preconditions, both of which are about the world being in a state where
 * the question means anything:
 *
 *   - no crisis is already live, because two would both tick; and
 *   - the two Germanies are still separate states, because a question about
 *     whether they should merge is meaningless once they have.
 *
 * The second is checked against the country registry rather than against a
 * flag, so a reunification that has already happened — by this crisis or by
 * anything else — closes the door on its own.
 *
 * A third refusal is a safety check rather than a rule: a resolution that has
 * not been actuated yet is a merge still pending, and opening on top of it
 * would produce a crisis whose challenger is dissolved a tick later. That is
 * the "still separate" condition being violated one turn in the future.
 *
 * Concurrency: two admins pressing at once both read "none live". The unique
 * partial index on `{ kind }` where `status: "open"` is the real guard; the read
 * below is the cheap path that gives a readable error instead of relying on a
 * caught duplicate key.
 */
import type { Db, Filter } from "mongodb";
import { MongoServerError } from "mongodb";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import type { CountryId } from "@/lib/constants/countries";
import {
  GERMAN_QUESTION_CHALLENGER,
  GERMAN_QUESTION_KIND,
  GERMAN_QUESTION_TARGET,
  SETTLEMENT_DEFAULT_RULES,
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_SEATS,
} from "@/lib/constants/settlementCrisis";
import { recomputePosition } from "./position";

export interface OpenCrisisResult {
  opened: boolean;
  /** Why it did not open. Null on success — shown to the admin who pressed it. */
  reason: string | null;
  crisisId: string | null;
}

const skip = (reason: string): OpenCrisisResult => ({ opened: false, reason, crisisId: null });

/** The authored opening board, before anyone has played or Bonn has drifted. */
export function buildGermanQuestion(turn: number): Omit<SettlementCrisisDoc, "_id"> {
  const institutions = SETTLEMENT_INSTITUTIONS.map((def) => ({
    id: def.id,
    weight: def.weight,
    position: def.opening,
    lastPlay: null,
    lastDrift: 0,
  }));
  const now = new Date();
  return {
    kind: GERMAN_QUESTION_KIND,
    status: "open",
    targetEntityId: GERMAN_QUESTION_TARGET,
    challengerEntityId: GERMAN_QUESTION_CHALLENGER,
    // Derived from the institutions on the way in, exactly as every later tick
    // derives it. Quoting the authored 38.2 as a literal here would let the
    // opening board disagree with its own cards if a weight ever changed.
    position: recomputePosition(institutions),
    institutions,
    seats: SETTLEMENT_SEATS.map((def) => ({
      id: def.id,
      // No banked capital or AP on turn one: the first tick's accrual is the
      // first budget anyone has, so the opening move costs a turn of waiting.
      capital: 0,
      actions: 0,
      lastActedTurn: null,
      committedPoints: 0,
    })),
    ladder: { heat: 0, armedTurn: null },
    rules: { ...SETTLEMENT_DEFAULT_RULES },
    driftHistory: [],
    // Null, not `turn`: the crisis opens at its authored figures and the first
    // drift lands on the next tick, so the board is visible as designed.
    lastTickedTurn: null,
    conflictId: null,
    openedTurn: turn,
    resolvedTurn: null,
    outcome: null,
    cooldownUntilTurn: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function openSettlementCrisis(
  db: Db,
  params: { turn: number }
): Promise<OpenCrisisResult> {
  const { turn } = params;
  const crises = await getSettlementCrisesCollection(db);

  const live = await crises.findOne({
    status: { $in: ["open", "frozen"] },
  } as Filter<SettlementCrisisDoc>);
  if (live) return skip("A settlement crisis is already live.");

  // A resolved-but-unactuated crisis is a merge still pending. Not a cooldown —
  // there is no cooldown any more — but opening here would name a challenger
  // that the pending actuation is about to dissolve.
  const pending = await crises.findOne({
    status: "resolved",
    cooldownUntilTurn: null,
  } as Filter<SettlementCrisisDoc>);
  if (pending) {
    return skip("The last question has resolved but not yet been enacted. Wait one turn.");
  }

  // Both Germanies must still exist as separate states.
  const registered = new Set<string>(await getRegisteredCountryIds(db));
  for (const id of [GERMAN_QUESTION_TARGET, GERMAN_QUESTION_CHALLENGER]) {
    if (!registered.has(id as CountryId)) {
      return skip(`${id} is no longer a live country — the Germanies are not separate.`);
    }
  }

  try {
    const inserted = await crises.insertOne(buildGermanQuestion(turn) as SettlementCrisisDoc);
    return { opened: true, reason: null, crisisId: inserted.insertedId.toString() };
  } catch (error) {
    // Duplicate key on the partial unique index: another admin opened it between
    // the read and the write.
    if (error instanceof MongoServerError && error.code === 11000) {
      return skip("Another operator opened it first.");
    }
    throw error;
  }
}
