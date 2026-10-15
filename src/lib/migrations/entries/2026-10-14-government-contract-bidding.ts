import type { Migration } from "../types";
import { ensureGovernmentContractIndexes } from "@/lib/governmentContracts/persistence";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";

/** Withdraw only unanswered legacy offers; active and historical signed contracts retain their terms. */
export const migration: Migration = {
  id: "2026-10-14-government-contract-bidding",
  description: "Install country tender indexes and retire unanswered direct government offers.",
  idempotent: true,
  execute: async (db, ctx) => {
    const defence = db.collection<
      DefenceContract & { biddingCutover?: boolean; biddingCutoverReleased?: boolean }
    >("defenceContracts");
    const pending = await defence.countDocuments({
      status: "pending",
      tenderId: { $exists: false },
    });
    const extraction = await db.collection("extractionContracts").countDocuments({
      status: "offered",
      tenderId: { $exists: false },
      revokedTurn: { $exists: false },
    });
    if (ctx.dryRun)
      return {
        documentsScanned: pending + extraction,
        documentsUpdated: 0,
        notes: [
          "Would create tender indexes and withdraw unanswered direct offers, preserving active contracts.",
        ],
      };
    await ensureGovernmentContractIndexes(db);
    const state = await db
      .collection<{ _id: string; currentTurn: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const turn = state?.currentTurn ?? 1;
    await defence.updateMany({ status: "pending", tenderId: { $exists: false } }, [
      {
        $set: {
          status: "cancelled",
          biddingCutover: true,
          termination: {
            basis: "withdrawal",
            fee: 0,
            lotsCancelled: {
              $max: [
                0,
                {
                  $subtract: [
                    { $ifNull: ["$lotsOrdered", { $ifNull: ["$allocatedLots", 0] }] },
                    { $ifNull: ["$lotsDelivered", 0] },
                  ],
                },
              ],
            },
            favorabilityPenalty: 0,
            turn,
          },
        },
      },
    ]);
    const release = await defence
      .find(
        { biddingCutover: true, biddingCutoverReleased: { $ne: true } },
        {
          projection: {
            _id: 1,
            countryId: 1,
            corporationId: 1,
            allocationWindowId: 1,
            encumberedAmount: 1,
            allocatedLots: 1,
            pricePerLot: 1,
          },
        }
      )
      .toArray();
    if (release.length) {
      await db.collection("federalBudget").bulkWrite(
        release.map((c) => {
          const marker = `governmentDirectOfferWithdrawals.${c._id.toHexString()}`;
          const amount = c.encumberedAmount ?? 0;
          return {
            updateOne: {
              filter: {
                countryId: c.countryId,
                [marker]: { $ne: true },
                "defenseAppropriation.encumbered": { $gte: amount },
              },
              update: {
                $inc: { "defenseAppropriation.encumbered": -amount },
                $set: { [marker]: true },
              },
            },
          };
        })
      );
      const budgetRows = await db
        .collection("federalBudget")
        .find(
          { countryId: { $in: [...new Set(release.map((c) => c.countryId))] } },
          { projection: { countryId: 1, governmentDirectOfferWithdrawals: 1 } }
        )
        .toArray();
      for (const c of release)
        if (
          (c.encumberedAmount ?? 0) > 0 &&
          !budgetRows.find((b) => b.countryId === c.countryId)?.governmentDirectOfferWithdrawals?.[
            c._id.toHexString()
          ]
        )
          throw new Error(
            "Cannot reconcile a direct offer's appropriation release; repair its commitment before resuming migration."
          );
      const allocations = release.filter((c) => c.allocationWindowId && (c.allocatedLots ?? 0) > 0);
      if (allocations.length)
        await db.collection("defenceProcurementAllocations").bulkWrite(
          allocations.map((c) => {
            const marker = `governmentDirectOfferWithdrawals.${c._id.toHexString()}`;
            const field = `supplierAmounts.${c.corporationId.toHexString()}`,
              amount = (c.allocatedLots ?? 0) * c.pricePerLot;
            return {
              updateOne: {
                filter: {
                  _id: c.allocationWindowId as never,
                  [marker]: { $ne: true },
                  countryAmount: { $gte: amount },
                  [field]: { $gte: amount },
                },
                update: {
                  $inc: { countryAmount: -amount, [field]: -amount },
                  $set: { [marker]: true },
                },
              },
            };
          })
        );
      if (allocations.length) {
        const quotaRows = await db
          .collection<{ _id: string; governmentDirectOfferWithdrawals?: Record<string, boolean> }>(
            "defenceProcurementAllocations"
          )
          .find(
            { _id: { $in: allocations.map((c) => c.allocationWindowId!) } },
            { projection: { governmentDirectOfferWithdrawals: 1 } }
          )
          .toArray();
        for (const c of allocations) {
          const quota = quotaRows.find((q) => q._id === c.allocationWindowId);
          if (quota && !quota.governmentDirectOfferWithdrawals?.[c._id.toHexString()])
            throw new Error(
              "Cannot reconcile a direct offer's quarterly quota release; repair its allocation before resuming migration."
            );
        }
      }
      await defence.updateMany(
        { _id: { $in: release.map((c) => c._id) } },
        { $set: { biddingCutoverReleased: true, encumberedAmount: 0 } }
      );
    }
    const result = await db
      .collection("extractionContracts")
      .updateMany(
        { status: "offered", tenderId: { $exists: false }, revokedTurn: { $exists: false } },
        { $set: { status: "expired", revokedTurn: turn, biddingCutover: true } }
      );
    const [withdrawnDefence, withdrawnExtraction] = await Promise.all([
      defence
        .find({ biddingCutover: true }, { projection: { _id: 1, corporationId: 1, countryId: 1 } })
        .toArray(),
      db
        .collection<ExtractionContract & { biddingCutover?: boolean }>("extractionContracts")
        .find({ biddingCutover: true }, { projection: { _id: 1, corporationId: 1, countryId: 1 } })
        .toArray(),
    ]);
    const withdrawn = [
      ...withdrawnDefence.map((c) => ({ ...c, type: "defence_contract_cancelled" })),
      ...withdrawnExtraction.map((c) => ({ ...c, type: "contract_expired" })),
    ];
    if (withdrawn.length) {
      const corporations = await db
        .collection("corporations")
        .find(
          { _id: { $in: withdrawn.map((c) => c.corporationId) } },
          { projection: { userId: 1, name: 1 } }
        )
        .toArray();
      const notices = withdrawn.flatMap((c) => {
        const corporation = corporations.find((p) => p._id.equals(c.corporationId));
        return corporation?.userId
          ? [
              {
                updateOne: {
                  filter: { _id: c._id },
                  update: {
                    $setOnInsert: {
                      userId: corporation.userId,
                      type: c.type,
                      title: "Government contract offer withdrawn",
                      message:
                        "Your unanswered government contract offer was withdrawn when competitive bidding replaced direct offers. Existing active contracts keep their signed terms.",
                      read: false,
                      createdAt: new Date(),
                      metadata: {
                        contractId: c._id.toHexString(),
                        corporationId: c.corporationId.toHexString(),
                        countryId: c.countryId,
                      },
                    },
                  },
                  upsert: true,
                },
              },
            ]
          : [];
      });
      if (notices.length) await db.collection("notifications").bulkWrite(notices);
    }
    return {
      documentsScanned: pending + extraction,
      documentsUpdated: release.length + result.modifiedCount,
      notes: [
        "Created tender indexes and withdrew unanswered direct offers. Active contracts were preserved.",
      ],
    };
  },
};
