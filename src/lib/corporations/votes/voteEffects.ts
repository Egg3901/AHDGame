import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CorporationVote } from "@/lib/db/types/corporationVote";
import { getDefaultLegalStructureId } from "@/lib/corporations/legalStructure";
import { executeCorporationBondDefaultDissolution } from "@/lib/bonds/executeCorporationBondDefaultDissolution";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { isValidSuperShareMultiplier } from "@/lib/corporations/superShares";
import { issuanceDilutionFactorExpr } from "@/lib/corporations/shareConsolidation";
import {
  prepareEquityPrimaryPlacement,
  refundPreparedEquityPlacement,
} from "@/lib/equities/primaryMarket";
import { emitTx } from "@/lib/financialTxLog/emit";

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
      if ((corporation.pendingShareIssuance?.remainingShares ?? 0) > 0) return;
      const placement = await prepareEquityPrimaryPlacement(
        db,
        corporation,
        newShareCount,
        issuancePrice,
        now
      );
      const placedShares = placement.placedShares;
      // The pool pays for the first tranche now. Approved shares it cannot
      // underwrite remain authorized but non-outstanding and place over time.
      let update;
      try {
        update = await db.collection<Corporation>("corporations").updateOne(
          {
            _id: corporation._id,
            "pendingShareIssuance.remainingShares": { $not: { $gt: 0 } },
          },
          [
            {
              $set: {
                totalShares: { $add: [{ $ifNull: ["$totalShares", 0] }, placedShares] },
                publicFloat: { $add: [{ $ifNull: ["$publicFloat", 0] }, placedShares] },
                ...(placement.poolActive
                  ? {
                      liquidCapital: {
                        $add: [{ $ifNull: ["$liquidCapital", 0] }, placement.paidLocal],
                      },
                      shareIssuanceProceeds: {
                        $add: [{ $ifNull: ["$shareIssuanceProceeds", 0] }, placement.paidLocal],
                      },
                    }
                  : {}),
                sharePrice: {
                  $round: [
                    {
                      $multiply: [
                        { $ifNull: ["$sharePrice", 0] },
                        issuanceDilutionFactorExpr(placedShares),
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
                        issuanceDilutionFactorExpr(placedShares),
                      ],
                    },
                    4,
                  ],
                },
                ...(placement.unsoldShares > 0
                  ? {
                      pendingShareIssuance: {
                        remainingShares: placement.unsoldShares,
                        requestedShares: newShareCount,
                        source: "vote",
                        createdAtTurn: currentTurn,
                        initialPriceLocal: issuancePrice,
                      },
                    }
                  : {}),
                updatedAt: now,
              },
            },
          ]
        );
      } catch (error) {
        await refundPreparedEquityPlacement(db, placement, now);
        throw error;
      }
      if (update.modifiedCount === 0) {
        await refundPreparedEquityPlacement(db, placement, now);
        return;
      }
      if (placedShares > 0) {
        void recordShareTrade(db, {
          corporationId: corporation._id,
          kind: "issuance",
          turn: currentTurn,
          shares: placedShares,
          pricePerShareAnchor: issuancePrice,
          from: null,
          to: null,
          corpCurrencyCode: issuanceCurrencyCode ?? corporation.liquidCurrencyCode,
          note: `Equity market pool placed ${placedShares.toLocaleString()} of ${newShareCount.toLocaleString()} vote-approved shares`,
        });
      }
      if (placement.poolActive && placement.paidLocal > 0) {
        void emitTx(db, {
          type: "ipo_proceeds",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: corporation._id,
          subjectName: corporation.name,
          amount: placement.paidLocal,
          currencyCode: placement.currency,
          meta: {
            sharesPlaced: placedShares,
            sharesRequested: newShareCount,
            sharesPending: placement.unsoldShares,
            counterparty: "equity_market_pool",
            approvedByVote: vote._id.toString(),
          },
        });
      }
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
