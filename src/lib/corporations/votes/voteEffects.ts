import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CorporationVote } from "@/lib/db/types/corporationVote";
import { getDefaultLegalStructureId } from "@/lib/corporations/legalStructure";
import { executeCorporationBondDefaultDissolution } from "@/lib/bonds/executeCorporationBondDefaultDissolution";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { isValidSuperShareMultiplier } from "@/lib/corporations/superShares";
import { issuanceDilutionFactorExpr } from "@/lib/corporations/shareConsolidation";

export async function applyPassedVoteEffects(opts: {
  db: Db;
  vote: CorporationVote;
  corporation: Corporation;
  currentTurn: number;
}): Promise<void> {
  const { db, vote, corporation, currentTurn } = opts;

  const now = new Date();

  switch (vote.type) {
    case "governance_change": {
      await db.collection("corporations").updateOne(
        { _id: corporation._id },
        {
          $set: {
            legalStructure: vote.payload.newLegalStructure,
            legalStructureChangeCooldownUntilTurn: currentTurn + 48,
            updatedAt: now,
          },
        }
      );
      break;
    }

    case "relocation": {
      const { destinationCountryId, destinationStateCode } = vote.payload;
      if (!destinationCountryId || !destinationStateCode) return;
      const newDefault = getDefaultLegalStructureId(destinationCountryId, {
        isPrivate: corporation.isPrivate === true,
      });
      // Cancel all other open votes — they are invalidated by the country change
      await db
        .collection("corporationVotes")
        .updateMany(
          { corporationId: corporation._id, status: "open", _id: { $ne: vote._id } },
          { $set: { status: "cancelled", resolvedAt: now, updatedAt: now } }
        );
      await db.collection("corporations").updateOne(
        { _id: corporation._id },
        {
          $set: {
            countryId: destinationCountryId,
            headquartersState: destinationStateCode,
            legalStructure: newDefault,
            legalStructureChangeCooldownUntilTurn: currentTurn + 48,
            updatedAt: now,
          },
        }
      );
      break;
    }

    case "share_issuance": {
      const { newShareCount, issuancePrice, issuanceCurrencyCode } = vote.payload;
      if (!newShareCount || !issuancePrice) return;
      // Vote-approved issuance (the >10%-dilution path the issue route redirects
      // here) creates float inventory only — no cash at issuance (Bug #0624). The
      // corp realizes proceeds as the float is actually bought (treasury-backed
      // market maker in the share-buy paths). Pre-fix this $inc'd liquidCapital at
      // share creation while the buy path credited again, double-paying the issuer.
      //
      // Prices are scaled DOWN by the dilution factor oldTotal / (oldTotal + new)
      // in the same atomic write. No cash enters at issuance, so market cap must
      // be preserved exactly like a forward split; leaving the price untouched
      // let a reverse-split-then-issue round trip fabricate market cap out of
      // thin air (2026-08-20 incident: reverse split multiplied the price ~250x
      // cap-preservingly, then an uncapped issuance vote restored the share
      // count at the pumped price, inflating market cap ~127x in one turn).
      // Aggregation pipeline so every $ references the pre-image atomically.
      await db.collection("corporations").updateOne({ _id: corporation._id }, [
        {
          $set: {
            totalShares: { $add: [{ $ifNull: ["$totalShares", 0] }, newShareCount] },
            publicFloat: { $add: [{ $ifNull: ["$publicFloat", 0] }, newShareCount] },
            sharePrice: {
              $round: [
                {
                  $multiply: [
                    { $ifNull: ["$sharePrice", 0] },
                    issuanceDilutionFactorExpr(newShareCount),
                  ],
                },
                4,
              ],
            },
            fundamentalSharePrice: {
              $round: [
                {
                  $multiply: [
                    { $ifNull: ["$fundamentalSharePrice", { $ifNull: ["$sharePrice", 0] }] },
                    issuanceDilutionFactorExpr(newShareCount),
                  ],
                },
                4,
              ],
            },
            updatedAt: now,
          },
        },
      ]);
      void recordShareTrade(db, {
        corporationId: corporation._id,
        kind: "issuance",
        turn: currentTurn,
        shares: newShareCount,
        pricePerShareAnchor: issuancePrice,
        from: null,
        to: null,
        corpCurrencyCode: issuanceCurrencyCode ?? corporation.liquidCurrencyCode,
        note: `Shareholder vote approved ${newShareCount.toLocaleString()} new shares at ${issuancePrice} per share`,
      });
      break;
    }

    case "adopt_supershares": {
      const multiplier = vote.payload.superShareMultiplier;
      if (!isValidSuperShareMultiplier(multiplier)) return;
      // Single atomic pipeline update: stamp the multiplier and mark the CEO's
      // current shares as supershares. The $exists guard makes a double-apply
      // (or a race with an IPO-path adoption) a no-op.
      await db
        .collection("corporations")
        .updateOne({ _id: corporation._id, superShareMultiplier: { $exists: false } }, [
          {
            $set: {
              superShareMultiplier: multiplier,
              superSharesAdoptedAtTurn: currentTurn,
              updatedAt: now,
              shareholders: {
                $map: {
                  input: { $ifNull: ["$shareholders", []] },
                  in: {
                    $cond: [
                      { $eq: ["$$this.characterId", corporation.ceoId] },
                      { $mergeObjects: ["$$this", { superShares: "$$this.shares" }] },
                      "$$this",
                    ],
                  },
                },
              },
            },
          },
        ]);
      break;
    }

    case "ticker_change": {
      const { newTicker } = vote.payload;
      if (!newTicker) return;
      // Double-check uniqueness at resolution time — another corp may have claimed
      // the ticker between proposal and vote close.
      const conflict = await db
        .collection("corporations")
        .findOne({ tickerSymbol: newTicker, _id: { $ne: corporation._id } });
      if (conflict) return;
      await db
        .collection("corporations")
        .updateOne({ _id: corporation._id }, { $set: { tickerSymbol: newTicker, updatedAt: now } });
      break;
    }

    case "dissolution": {
      await withCorporationSettlementLock(db, corporation._id, "dissolutionInProgressAt", now, () =>
        executeCorporationBondDefaultDissolution(db, corporation, {
          requireDefaultedBonds: false,
        })
      );
      break;
    }
  }
}
