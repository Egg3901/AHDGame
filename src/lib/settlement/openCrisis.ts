/**
 * Opening the German Question.
 *
 * Nothing else creates a settlement crisis. It is deliberately NOT a reset-time
 * seed: a reset would only reach worlds that are re-seeded, and the master gate
 * is expected to be flipped on a world that is already running. Checking every
 * tick makes the crisis self-healing — switch the flag on in the 1953 preset
 * and the question opens on the next turn, with no migration to run.
 *
 * The four preconditions are all things that can change under the feature's
 * feet, which is why they are tested here rather than at seed time:
 *
 *   - the era window, because a world plays forward out of it;
 *   - the two Germanies both existing, because a resolved crisis MERGES one of
 *     them and the question must not then reopen against a country that is
 *     gone (or, worse, against itself);
 *   - the re-open cooldown, because a Western win is explicitly not a permanent
 *     lock;
 *   - no crisis already live, because two would both tick.
 *
 * The last of those is racy by nature — two overlapping turn runs both read
 * "none open". The unique partial index on `{ kind }` where `status: "open"` is
 * the real guard; the read is the cheap path that avoids relying on a caught
 * duplicate-key error every tick.
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
  SETTLEMENT_MAX_YEAR,
  SETTLEMENT_MIN_YEAR,
  SETTLEMENT_SEATS,
} from "@/lib/constants/settlementCrisis";
import { recomputePosition } from "./position";

export interface OpenCrisisResult {
  opened: boolean;
  /** Why it did not open. Null on success — surfaced in the turn log. */
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
    // Null, not `turn`: the phase that opens the crisis has already done its
    // sweeps this tick, so the first real tick is the next one.
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

export async function openSettlementCrisisIfDue(
  db: Db,
  params: { turn: number; year: number | null }
): Promise<OpenCrisisResult> {
  const { turn, year } = params;

  if (year === null) return skip("the world has no resolvable year");
  if (year < SETTLEMENT_MIN_YEAR || year > SETTLEMENT_MAX_YEAR) {
    return skip(`${year} is outside ${SETTLEMENT_MIN_YEAR}-${SETTLEMENT_MAX_YEAR}`);
  }

  const crises = await getSettlementCrisesCollection(db);

  const live = await crises.findOne({
    status: { $in: ["open", "frozen"] },
  } as Filter<SettlementCrisisDoc>);
  if (live) return skip("a settlement crisis is already live");

  // The most recent close. `cooldownUntilTurn: null` means it has resolved but
  // not been actuated yet — the actuation sweep runs before this, so seeing one
  // here means it failed, and reopening on top of a pending absorption would be
  // the worst possible moment.
  const lastClosed = await crises
    .find({ status: "resolved" } as Filter<SettlementCrisisDoc>)
    .sort({ resolvedTurn: -1 })
    .limit(1)
    .toArray();
  const previous = lastClosed[0];
  if (previous) {
    if (previous.cooldownUntilTurn == null) return skip("the last question has not been actuated");
    if (previous.cooldownUntilTurn > turn) {
      return skip(`cooling down until turn ${previous.cooldownUntilTurn}`);
    }
  }

  // Both Germanies must still exist as separate states. After a reunification
  // win one of them is dissolved, and the registry is the authority on that.
  const registered = new Set<string>(await getRegisteredCountryIds(db));
  for (const id of [GERMAN_QUESTION_TARGET, GERMAN_QUESTION_CHALLENGER]) {
    if (!registered.has(id as CountryId)) return skip(`${id} is not a live country`);
  }

  try {
    const doc = buildGermanQuestion(turn);
    const inserted = await crises.insertOne(doc as SettlementCrisisDoc);
    return { opened: true, reason: null, crisisId: inserted.insertedId.toString() };
  } catch (error) {
    // Duplicate key on the partial unique index: another turn runner opened it
    // between the read and the write. That is a success for the world, just not
    // for this runner.
    if (error instanceof MongoServerError && error.code === 11000) {
      return skip("another runner opened it first");
    }
    throw error;
  }
}
