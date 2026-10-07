import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { seededIncomeVintageId } from "@/lib/seeds/reference/income1991";

/** Countries whose 1991 metric seed writers can write a dated income vintage. */
export const INCOME_VINTAGE_SEED_COUNTRIES = ["NG", "CN", "TR"] as const;

/**
 * Record the income vintage a metric seed writer just wrote for `countryId`, or
 * clear it when the writer wrote legacy incomes. Called only by the writer, after
 * its write, so the stamp always describes the stored values.
 *
 * Not an upsert: on an empty database the seeders run before
 * `initializeGameState`, and an upserted stub would block that initializer.
 * `bootstrapGameWorld` re-applies the stamps once the doc exists.
 */
export async function stampSeededIncomeVintage(
  db: Db,
  countryId: (typeof INCOME_VINTAGE_SEED_COUNTRIES)[number],
  preset: string
): Promise<void> {
  const id = seededIncomeVintageId(countryId, preset);
  const field = `incomeStartVintages.${countryId}`;
  await db
    .collection<GameState>("gameState")
    .updateOne({ _id: "current" }, id ? { $set: { [field]: id } } : { $unset: { [field]: "" } });
}

/** Re-apply every writer's stamp after this bootstrap's country seed completed. */
export async function stampSeededIncomeVintages(db: Db, preset: string): Promise<void> {
  const set: Record<string, string> = {};
  const unset: Record<string, ""> = {};
  for (const countryId of INCOME_VINTAGE_SEED_COUNTRIES) {
    const id = seededIncomeVintageId(countryId, preset);
    if (id) set[`incomeStartVintages.${countryId}`] = id;
    else unset[`incomeStartVintages.${countryId}`] = "";
  }
  await db.collection<GameState>("gameState").updateOne(
    { _id: "current" },
    {
      ...(Object.keys(set).length > 0 ? { $set: set } : {}),
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    }
  );
}
