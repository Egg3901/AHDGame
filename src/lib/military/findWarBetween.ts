import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { opposedBelligerents } from "@/lib/military/occupation";

/**
 * The live war these two countries are already fighting against each other, if any.
 *
 * ONE war at a time between the same pair. Both halves of a declaration call this —
 * `validateDeclareWar` at proposal, `declareWar` at enactment — because a bill sits
 * before the chambers for turns and the pair can become opposed in the meantime, via
 * a third country's war. Checking only at proposal would let the enactment open a
 * second war anyway.
 *
 * The two checks live in ONE function rather than one copy each. This branch has
 * already been bitten by the other arrangement: the two-thirds pass rule was added
 * to the validator with a defaulted argument, so the engine kept applying a simple
 * majority and no type error could say so.
 *
 * Scanned across every live conflict rather than the ones hosted by either party,
 * because a pair can be opposed in a war hosted by a third country and neither
 * host-scoped lookup would see it.
 */
export async function findWarBetween(
  db: Db,
  x: CountryId,
  y: CountryId
): Promise<ConflictDoc | null> {
  // Mongo narrows to conflicts holding BOTH countries; `opposedBelligerents` then
  // confirms they are on OPPOSING rosters rather than side by side.
  const shared = await getConflictsCollection(db)
    .find({
      status: { $ne: "resolved" },
      $and: [
        { $or: [{ "sideA.countries": x }, { "sideB.countries": x }] },
        { $or: [{ "sideA.countries": y }, { "sideB.countries": y }] },
      ],
    })
    .toArray();
  return shared.find((c) => opposedBelligerents(c, x, y)) ?? null;
}
