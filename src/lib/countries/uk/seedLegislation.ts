import type { Db } from "mongodb";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

/**
 * Admin-only destructive re-seed for UK legislation types
 * (`countryScope: "uk"`). Deletes existing UK types, then inserts fresh
 * copies from the live `legislationTypes` array.
 *
 * NOT called from `bootstrapGameWorld` or `resetGameWorld` — those paths
 * upsert every `LegislationType` document (US + UK + JP + DE + CN + IE +
 * BR) via `runCoreSeed`'s consolidated `legislationTypes` seed, so
 * calling this here would double-write the UK subset. Surfaced only at
 * `/api/admin/seed` under the `"ukLegislation"` target for ad-hoc
 * "blow away and re-seed UK legislation" operations.
 */
export async function seedUkLegislation(db: Db, log: (msg: string) => void) {
  // Remove existing UK legislation types
  const deleteResult = await db
    .collection<LegislationType>("legislationTypes")
    .deleteMany({ countryScope: "uk" });
  const deletedCount = deleteResult.deletedCount || 0;

  const ukTypes = legislationTypes.filter((lt) => lt.countryScope === "uk");

  if (ukTypes.length > 0) {
    await db.collection<LegislationType>("legislationTypes").insertMany(ukTypes);
  }

  log(
    `Seeded ${ukTypes.length} UK legislation types (removed ${deletedCount} existing, inserted ${ukTypes.length})`
  );
}
