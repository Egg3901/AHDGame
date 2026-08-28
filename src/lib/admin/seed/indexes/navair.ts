import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the naval and air layer.
 *
 *   - `navairChannels` on (countryId, region), UNIQUE. `saveNavairChannels` upserts on
 *     exactly this pair every turn. Without the unique constraint two concurrent upserts
 *     for the same country and region both miss the filter and both insert, and the
 *     collection quietly grows duplicate rows. `loadNavairChannels` builds a Map keyed on
 *     the same pair, so the duplicates would not throw: one row would simply win at
 *     random each turn and a country's sea control would flicker between two histories.
 *     That is the kind of fault that looks like a balance problem for a month.
 *
 *   - `militaryUnits` on (domain), because `navairOperations` and `battleResolution` both
 *     read `{ domain: { $in: ["naval", "air"] } }` every single turn. Unindexed that is a
 *     full collection scan twice a turn, on a phase that has a turn-time budget.
 */
export async function seedNavairIndexes(db: Db, log: (msg: string) => void) {
  log("Naval and air indexes:");

  await ensureIndex(
    db,
    "navairChannels",
    { countryId: 1, region: 1 },
    { name: "navairChannels_country_region_unique", unique: true },
    log
  );

  // Supports the per-turn "every hull and wing in the world" read. Not unique: a country
  // has many units per domain, which is the point.
  await ensureIndex(db, "militaryUnits", { domain: 1 }, { name: "militaryUnits_domain" }, log);

  // Stationing reads and the war room both ask "what is in this region", and the turn
  // pass groups by station. Sparse because only naval and air formations carry one, so
  // the index does not pay for every ground unit in the game.
  await ensureIndex(
    db,
    "militaryUnits",
    { station: 1 },
    { name: "militaryUnits_station", sparse: true },
    log
  );

  // The war room asks "what happened in these regions lately", newest first.
  await ensureIndex(
    db,
    "navairEngagements",
    { region: 1, turn: -1 },
    { name: "navairEngagements_region_turn" },
    log
  );

  log("Naval and air indexes ensured");
}
