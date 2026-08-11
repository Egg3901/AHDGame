/**
 * Cascade helper invoked before a character is hard-deleted (self-delete or
 * admin-delete). Historically the delete flows only removed rows from
 * `characters` / `users` and left corporation state dangling.
 *
 * On delete, release the character's personal holdings, unwind any active
 * market activity for the character and any CEO-led corporations they are
 * abandoning, then vacate the CEO seat using the standard vacancy markers.
 */

import type { Db, ObjectId } from "mongodb";
import type { Bond, Corporation, ElectionCandidate, GameState } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  cleanupShareMarketActivityForCharacters,
  cleanupShareMarketActivityForCorporations,
} from "@/lib/corporations/cleanupShareMarketActivity";
import { releaseCharacterHeldSharesToFloat } from "@/lib/corporations/releaseCharacterHeldSharesToFloat";
import { releaseCorporationHeldSharesToFloat } from "@/lib/corporations/releaseHeldSharesToFloat";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";

export interface CascadeResult {
  sharesReleased: number;
  corpsShareholderCleared: number;
  corporationSharesReleased: number;
  corporationSharePositionsCleared: number;
  corpsCeoVacated: number;
  corpsPendingCeoCleared: number;
  /** CEO-led corps that carried outstanding bonds and were force-dissolved (waterfall) instead of vacated. */
  corpsDissolvedOnAbandonment: number;
  ordersCancelled: number;
  listingsCancelled: number;
  offersCancelled: number;
  activeCandidaciesWithdrawn: number;
}

export async function cascadeCharacterDeletion(
  db: Db,
  characterId: ObjectId
): Promise<CascadeResult> {
  const corps = db.collection<Corporation>("corporations");
  const now = new Date();
  const forexEnabled = await isForexEnabled();

  // Charter cleanup — auto-reject any in-flight charter signatures
  // bound to this character and transition affected charters to
  // founder-replacement so surviving founders can nominate a replacement.
  const activeCharterStatuses = ["draft", "pending-signatures", "founder-replacement"];
  const affectedCharters = await db
    .collection("partyCharters")
    .find({
      foundersCharacterIds: characterId,
      status: { $in: activeCharterStatuses },
    })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  if (affectedCharters.length > 0) {
    const { computeCharterDeadline, computeCharterDeadlineTurn } =
      await import("@/lib/charters/charterDeadlines");
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    const replacementDeadline = computeCharterDeadline(now);
    const charterTurn = await getCurrentTurn(db);
    const replacementDeadlineTurn = computeCharterDeadlineTurn(charterTurn);
    for (const charter of affectedCharters) {
      await db.collection("partyCharters").updateOne(
        {
          _id: charter._id,
          "signatures.characterId": characterId,
          "signatures.rejectedAt": { $exists: false },
        },
        {
          $set: {
            "signatures.$.rejectedAt": now,
            "signatures.$.rejectionReason": "Founder character deleted",
            status: "founder-replacement",
            founderReplacementDeadline: replacementDeadline,
            founderReplacementDeadlineTurn: replacementDeadlineTurn,
            updatedAt: now,
          },
        }
      );
    }
  }

  const ceoCorps = await corps.find({ ceoId: characterId }).toArray();
  const ceoCorpIds = ceoCorps.map((corp) => corp._id);

  // An abandoning CEO can leave a corp carrying outstanding (non-matured) bonds.
  // Simply vacating the seat orphans that debt — the corp becomes a permanent
  // zombie no one can dissolve or take over (dissolve/takeover both refuse while
  // bonds exist), and its held shares get dumped to public float instead of
  // settling creditors. For those corps, run the full bond-default dissolution
  // waterfall instead: bondholders are paid first, the remainder (including
  // cross-equity, in-kind) flows to shareholders, sectors return to Unowned, and
  // the corp is deleted. Corps with no outstanding bonds keep the lightweight
  // vacate-and-release path below. National / IMF corps are never auto-dissolved.
  const bondedCorpIds =
    ceoCorpIds.length > 0
      ? await db.collection<Bond>("bonds").distinct("corporationId", {
          corporationId: { $in: ceoCorpIds },
          matured: false,
        })
      : [];
  const bondedCorpIdSet = new Set(bondedCorpIds.map((id) => id.toString()));
  const dissolveCorps = ceoCorps.filter(
    (corp) =>
      bondedCorpIdSet.has(corp._id.toString()) && !corp.countryOwnerId && !corp.imfInstitution
  );
  const dissolveCorpIdSet = new Set(dissolveCorps.map((corp) => corp._id.toString()));
  // Corps that take the lightweight vacate path: everything that isn't being
  // dissolved (no bonds, or a national/IMF corp we won't auto-liquidate).
  const vacateCorpIds = ceoCorpIds.filter((id) => !dissolveCorpIdSet.has(id.toString()));

  const characterMarketCleanup = await cleanupShareMarketActivityForCharacters(
    db,
    [characterId],
    now,
    forexEnabled
  );
  // Dissolution runs its own market-activity cleanup; only clean the corps that
  // survive as vacated shells here.
  const corporationMarketCleanup = await cleanupShareMarketActivityForCorporations(
    db,
    vacateCorpIds,
    now,
    forexEnabled
  );

  const releasedCharacterShares = await releaseCharacterHeldSharesToFloat(db, [characterId], now);

  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  const currentTurn = gameState?.currentTurn ?? 0;

  // Force-dissolve abandoned corps that still owe bondholders. Each runs under
  // the shared settlement lock so we don't race an in-flight bond settlement,
  // and a failure on one corp must not abort the character deletion — fall back
  // to leaving it vacated (it can still be admin force-liquidated later).
  let corpsDissolvedOnAbandonment = 0;
  if (dissolveCorps.length > 0) {
    const { executeCorporationBondDefaultDissolution } =
      await import("@/lib/bonds/executeCorporationBondDefaultDissolution");
    for (const corp of dissolveCorps) {
      try {
        const result = await withCorporationSettlementLock(
          db,
          corp._id,
          "bondSettlementInProgressAt",
          now,
          () =>
            executeCorporationBondDefaultDissolution(db, corp, {
              requireDefaultedBonds: false,
            })
        );
        if (result) {
          corpsDissolvedOnAbandonment += 1;
        } else {
          // Settlement already in progress — leave the corp for that flow / admin.
          vacateCorpIds.push(corp._id);
        }
      } catch (err) {
        console.error(
          `cascadeCharacterDeletion: failed to dissolve abandoned corp ${corp._id.toString()}`,
          err
        );
        // Couldn't dissolve — fall back to vacating so deletion still proceeds.
        vacateCorpIds.push(corp._id);
      }
    }
  }

  // Release held shares to float only for the corps that survive as vacated
  // shells. Dissolved corps already distributed their cross-equity in-kind.
  let corporationSharesReleased = 0;
  let corporationSharePositionsCleared = 0;
  for (const ceoCorpId of vacateCorpIds) {
    const releasedCorpShares = await releaseCorporationHeldSharesToFloat(db, ceoCorpId, now);
    corporationSharesReleased += releasedCorpShares.sharesReleased;
    corporationSharePositionsCleared += releasedCorpShares.corpsShareholderCleared;
  }

  const ceoRes = await corps.updateMany(
    { ceoId: characterId, ceoVacant: { $ne: true } },
    {
      $set: {
        ceoVacant: true,
        ceoVacantSinceTurn: currentTurn,
        updatedAt: now,
      },
      $unset: { ceoId: "", userId: "" },
    }
  );

  const pendingRes = await corps.updateMany(
    { pendingCeoCharacterId: characterId },
    { $unset: { pendingCeoCharacterId: "" }, $set: { updatedAt: now } }
  );

  // Close CEO tenure for the corps that still exist (dissolved corps are gone).
  for (const corpId of vacateCorpIds) {
    await closeCeoTenure(db, corpId, { holderId: characterId, turn: currentTurn });
  }

  // Withdraw any still-active election candidacies. A hard-deleted character
  // that remains an active candidate can still win a resolving election and be
  // seated as a phantom officeholder referencing a character that no longer
  // exists (the IL Class III senator). retireCharacter already does this; the
  // hard-delete flows (self-delete / admin force-delete) route through here.
  const candidacyRes = await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { characterId, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );

  return {
    sharesReleased: releasedCharacterShares.sharesReleased,
    corpsShareholderCleared: releasedCharacterShares.positionsReleased,
    corporationSharesReleased,
    corporationSharePositionsCleared,
    corpsCeoVacated: ceoRes.modifiedCount ?? 0,
    corpsPendingCeoCleared: pendingRes.modifiedCount ?? 0,
    corpsDissolvedOnAbandonment,
    ordersCancelled:
      characterMarketCleanup.ordersCancelled + corporationMarketCleanup.ordersCancelled,
    listingsCancelled:
      characterMarketCleanup.listingsCancelled + corporationMarketCleanup.listingsCancelled,
    offersCancelled:
      characterMarketCleanup.offersCancelled + corporationMarketCleanup.offersCancelled,
    activeCandidaciesWithdrawn: candidacyRes.modifiedCount ?? 0,
  };
}
