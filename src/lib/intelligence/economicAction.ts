import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types/corporation";
import { BOOKS_EXPOSED_TURNS } from "./config";

export interface EconomicActionResult {
  corporationsExposed: number;
  exposedUntilTurn: number | null;
}

const NOTHING: EconomicActionResult = { corporationsExposed: 0, exposedUntilTurn: null };

/**
 * Leak one of the target country's corporations.
 *
 * The books simply come out: `financialFogOfWar` is skipped for that company
 * until the exposure lapses, so every viewer reads its real financials instead
 * of a quarterly estimate. Nothing here moves a number. What follows is the
 * market reacting to something it can now read, which is the point, and is why
 * this carries no balance-report gate the way a production magnitude would.
 *
 * ONE company, and the largest by liquid capital rather than a random one: a
 * service picks its target, and a leak that landed on a shell would be a waste
 * of an operation. Private companies are skipped because their books were never
 * fogged for outsiders in the first place - they are redacted outright, which is
 * a different rule that this operation has no business dissolving.
 */
export async function applyEconomicAction(
  db: Db,
  targetCountryId: CountryId,
  turn: number
): Promise<EconomicActionResult> {
  // Accessed directly, matching every other corporations caller in the repo:
  // there is no getter module for this collection.
  const corporations = db.collection<Corporation>("corporations");
  const target = await corporations
    .find({ countryId: targetCountryId, isPrivate: { $ne: true } })
    .sort({ liquidCapital: -1 })
    .limit(1)
    .toArray();

  if (target.length === 0) return NOTHING;

  const exposedUntilTurn = turn + BOOKS_EXPOSED_TURNS;
  await corporations.updateOne(
    { _id: target[0]._id },
    { $set: { booksExposedUntilTurn: exposedUntilTurn } }
  );
  return { corporationsExposed: 1, exposedUntilTurn };
}
