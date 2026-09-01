import type { Db } from "mongodb";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import type { CountryGameState } from "@/lib/db/types/gameState";

/**
 * The runtime "registered countries" set: the static COUNTRY_ORDER base PLUS any
 * country whose countryGameStates row has been flipped to `status: "active"`
 * (e.g. a seceded SCO/WAL). De-duped; COUNTRY_ORDER first, then activated extras
 * in deterministic order. This is the iteration/processing source — use it instead
 * of raw COUNTRY_ORDER at any server site that must reflect live countries.
 */
export async function getRegisteredCountryIds(db: Db): Promise<CountryId[]> {
  // Two queries' worth of rows in one read: the actives that widen the base,
  // and the dissolved that narrow it.
  const docs = await db
    .collection<CountryGameState>("countryGameStates")
    .find({ $or: [{ status: "active" }, { dissolvedTurn: { $ne: null } }] })
    .toArray();
  const activeExtra = docs
    .filter((d) => d.status === "active" && d.dissolvedTurn == null)
    .map((d) => d._id as CountryId)
    .filter((id) => !COUNTRY_ORDER.includes(id));
  // A country absorbed into another leaves the registry. Without this the base
  // list is add-only and a merged country stays enumerated forever.
  const dissolved = new Set(docs.filter((d) => d.dissolvedTurn != null).map((d) => String(d._id)));
  // Stable order: COUNTRY_ORDER base, then activated extras (sorted for determinism).
  return [...COUNTRY_ORDER, ...activeExtra.sort()].filter((id) => !dissolved.has(id));
}

/**
 * The live countries, as a set, for filtering a collection scan.
 *
 * A DISSOLVED COUNTRY KEEPS ITS BUDGET DOC — for history, for the wiki, and so a
 * merge has somewhere to stamp `mergedInto`. Every fiscal phase that scans
 * `federalBudget.find({})` therefore has to exclude it explicitly, or an absorbed
 * country goes on running a full simulation for ever: tax bases growing, treasury
 * accruing, reporting a national economy it has neither the regions nor the
 * population to earn. A reunified Germany left its predecessor shell computing
 * the same GDP and tax bases as the live unified state, and a treasury the merge
 * had zeroed climbed back into the billions.
 */
export async function getRegisteredCountryIdSet(db: Db): Promise<Set<string>> {
  return new Set<string>(await getRegisteredCountryIds(db));
}

/**
 * Mark a latent country live: idempotent upsert of an active+enabled row. Called
 * by the SP2d secession actuation (and admin tools). Surfacing is immediate —
 * getRegisteredCountryIds + the access layer both read this row at runtime.
 */
export async function activateCountry(db: Db, countryId: CountryId): Promise<void> {
  await db
    .collection<CountryGameState>("countryGameStates")
    .updateOne(
      { _id: countryId },
      { $set: { status: "active", enabledForPlayers: true, updatedAt: new Date() } },
      { upsert: true }
    );
}
