/** Guarded metadata writes share the corporation phase's existing bulk command. */
import type { AnyBulkWriteOperation } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  matureHoldingTerms,
  SHORT_TERM_HOLDING_TURNS,
  validateHoldingTerms,
} from "@/lib/corporations/rules/holdingTerms";
export function holdingMaturationWrites(
  corporation: Pick<Corporation, "_id" | "shareholders">,
  turn: number
): AnyBulkWriteOperation<Corporation>[] {
  return (corporation.shareholders ?? []).flatMap((holder) => {
    const ownerKey = holder.characterId
      ? "characterId"
      : holder.imperialCharacterId
        ? "imperialCharacterId"
        : undefined;
    if (
      !ownerKey ||
      !holder.holdingTerms?.shortTermLots.some(
        (lot) => turn - lot.acquiredTurn >= SHORT_TERM_HOLDING_TURNS
      )
    )
      return [];
    validateHoldingTerms(holder.holdingTerms, holder.shares);
    return [
      {
        updateOne: {
          filter: {
            _id: corporation._id,
            shareholders: {
              $elemMatch: {
                [ownerKey]: holder[ownerKey],
                shares: holder.shares,
                holdingTerms: holder.holdingTerms,
              },
            },
          },
          update: {
            $set: { "shareholders.$.holdingTerms": matureHoldingTerms(holder.holdingTerms, turn) },
          },
        },
      },
    ];
  });
}
