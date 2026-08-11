import type { Db } from "mongodb";
import type { Counter } from "./types/counter";
import type { CountryId } from "../constants/countries";

/**
 * Get the next sequential ID for a given entity type.
 * For parties, uses country-specific counters (party_US, party_UK).
 */
export async function getNextSequentialId(
  db: Db,
  type: "character" | "npp" | "corporation" | "imperial" | "conflict"
): Promise<number>;
export async function getNextSequentialId(
  db: Db,
  type: "party" | "coalition",
  countryId: CountryId
): Promise<number>;
export async function getNextSequentialId(
  db: Db,
  type: "character" | "npp" | "corporation" | "imperial" | "conflict" | "party" | "coalition",
  countryId?: CountryId
): Promise<number> {
  const counterId = type === "party" || type === "coalition" ? `${type}_${countryId}` : type;

  const counter = await db
    .collection<Counter>("counters")
    .findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );

  if (!counter?.seq) {
    throw new Error(`Failed to get next sequential ID for ${counterId}`);
  }

  return counter.seq;
}

/**
 * Reserve `count` consecutive sequential ids in a single round trip.
 *
 * Same counter document and the same atomic `findOneAndUpdate` as
 * {@link getNextSequentialId} — the increment is N instead of 1 and the caller
 * owns the whole returned block. Uniqueness and monotonicity are therefore
 * identical, and the two can interleave freely: a live single allocation
 * between two reservations simply takes the next id.
 *
 * For callers that know their count up front and are allocating in a loop. A
 * seed allocates 436 NPP ids one await at a time, which is 436 round trips to
 * increment one integer. Single-entity callers (a player creating a character,
 * a corporation being founded) should keep using {@link getNextSequentialId} —
 * they do not know a count, and one id is one round trip either way.
 *
 * Reserving more than you use is safe but leaves a gap: ids are unique and
 * increasing, never contiguous by contract. `realignPartyCountersToExisting`
 * already resolves counters via `max(sequentialId)` rather than assuming
 * contiguity. `count: 0` performs no write at all, so a pass that turns out to
 * have nothing to create stays a true no-op.
 */
export async function reserveSequentialIds(
  db: Db,
  type: "character" | "npp" | "corporation" | "imperial" | "conflict",
  count: number
): Promise<number[]>;
export async function reserveSequentialIds(
  db: Db,
  type: "party" | "coalition",
  count: number,
  countryId: CountryId
): Promise<number[]>;
export async function reserveSequentialIds(
  db: Db,
  type: "character" | "npp" | "corporation" | "imperial" | "conflict" | "party" | "coalition",
  count: number,
  countryId?: CountryId
): Promise<number[]> {
  if (count <= 0) return [];

  const counterId = type === "party" || type === "coalition" ? `${type}_${countryId}` : type;

  const counter = await db
    .collection<Counter>("counters")
    .findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: count } },
      { upsert: true, returnDocument: "after" }
    );

  const end = counter?.seq;
  // `end < count` means the increment did not land (a counter that came back
  // stale or unset). Handing out ids from an unreserved range would collide,
  // so fail instead — same contract as getNextSequentialId's `!counter?.seq`.
  if (typeof end !== "number" || end < count) {
    throw new Error(`Failed to reserve ${count} sequential IDs for ${counterId}`);
  }

  const start = end - count + 1;
  return Array.from({ length: count }, (_, i) => start + i);
}

/**
 * Reset party counters for all countries.
 * Called during game reset when parties are deleted.
 */
export async function resetPartyCounters(db: Db, countryIds?: readonly string[]): Promise<void> {
  // `countryIds` scopes the reset to the countries whose parties the caller is
  // actually rebuilding. `runSeed` passes ["US"]: it is the US pack, and wiping
  // every `party_<country>` counter while re-seeding only US parties hands the
  // next UK insert seqId 1, colliding with Labour — the exact collision
  // `resetGameWorld`'s counter comment warns about. Measured on the standalone
  // reset path as counters 25 -> 2.
  //
  // Omit to wipe them all, which is right only when every party is being
  // deleted too (the `deleteDefaultParties` branch).
  await db
    .collection<Counter>("counters")
    .deleteMany(
      countryIds
        ? { _id: { $in: countryIds.map((id) => `party_${id}`) } }
        : { _id: { $regex: /^party_/ } }
    );
}

/**
 * Realign every `party_<country>` counter so its `seq` equals the largest
 * `sequentialId` currently in the `politicalParties` collection for that
 * country. Used during game reset before `ensureDefaultParties` so a
 * newly-added default party (e.g. UUP when switching to the 1991 preset)
 * always gets `max + 1`, never colliding with a surviving party — and so
 * the system self-heals after any prior failed reset that left the
 * counter wiped or stale.
 *
 * If a country has no parties, that counter is left missing (so the next
 * insert starts at 1 via upsert in getNextSequentialId).
 */
export async function realignPartyCountersToExisting(db: Db): Promise<void> {
  const groups = (await db
    .collection("politicalParties")
    .aggregate([{ $group: { _id: "$countryId", maxSeq: { $max: "$sequentialId" } } }])
    .toArray()) as Array<{ _id: string; maxSeq: number | null }>;

  for (const g of groups) {
    if (typeof g.maxSeq !== "number" || g._id == null) continue;
    await db
      .collection<Counter>("counters")
      .updateOne({ _id: `party_${g._id}` }, { $set: { seq: g.maxSeq } }, { upsert: true });
  }
}
