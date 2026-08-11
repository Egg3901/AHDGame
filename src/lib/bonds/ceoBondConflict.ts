import type { Db, ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types";

export type BondHolderField = "characterId" | "imperialCharacterId";

/**
 * Total bond units a holder owns across ALL of a corporation's bond series.
 * `holds` is true when the summed unit count is > 0. Used to enforce the
 * CEO ⊥ bondholder invariant (a controller cannot also be a creditor of the
 * same corp) at the ceo/accept, ceo/vote, and bond-buy enforcement points.
 */
export async function holdsAnyBondsInCorp(
  db: Db,
  holderId: ObjectId,
  holderField: BondHolderField,
  corpId: ObjectId
): Promise<{ holds: boolean; units: number }> {
  const bonds = await db
    .collection<Bond>("bonds")
    .find({ corporationId: corpId, [`holders.${holderField}`]: holderId })
    .toArray();

  let units = 0;
  for (const bond of bonds) {
    for (const holder of bond.holders ?? []) {
      const id = holder[holderField];
      if (id && id.equals(holderId)) units += holder.units ?? 0;
    }
  }
  return { holds: units > 0, units };
}
