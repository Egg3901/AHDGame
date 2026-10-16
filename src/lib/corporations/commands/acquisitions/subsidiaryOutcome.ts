/**
 * Shell for the "keep the target as a subsidiary" acquisition outcome: loads the
 * facts the portable rules judge (`rules/subsidiaryOutcome.ts`) and performs the
 * one structural write the outcome adds, the equity transfer.
 *
 * Money does not live here. The price is debited from the acquirer and paid to
 * the target's former holders by the same pinned, stamped settlement legs a
 * merge uses; this module only changes who owns the shares afterwards.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation, GameState } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";
import {
  isEligibleAsSubsidiary,
  subsidiaryCeoBlockReason,
  wouldCreateOwnershipCycle,
} from "@/lib/corporations/subsidiaries/helpers";
import {
  collectSiblingSubsidiaryCeoUserIds,
  resolveParentCeoUserId,
} from "@/lib/corporations/subsidiaries/parentContext";
import {
  holdsWholeCapTable,
  subsidiaryAcquisitionBlock,
  wholeCorporationPosition,
  type SubsidiaryAcquisitionFacts,
  type SubsidiaryBlock,
} from "./rules/subsidiaryOutcome";

const SYSTEM_USER_ID = "000000000000000000000000";

async function subsidiaryFeatureEnabled(db: Db): Promise<boolean> {
  const state = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { subsidiaryCorporationsEnabled: 1 } });
  return state?.subsidiaryCorporationsEnabled === true;
}

/** Whether the world allows subsidiary-mode acquisitions at all (UI discovery). */
export function isSubsidiaryAcquisitionAvailable(db: Db): Promise<boolean> {
  return subsidiaryFeatureEnabled(db);
}

/**
 * Resolve every fact the subsidiary outcome is judged on. One cap-table read of
 * the corporation graph (the same projection the formalize and purchase-time
 * cycle guards use) plus the one-person-rule lookups.
 */
async function gatherFacts(
  db: Db,
  acquirer: Corporation,
  target: Corporation
): Promise<SubsidiaryAcquisitionFacts> {
  const [featureEnabled, allCorps] = await Promise.all([
    subsidiaryFeatureEnabled(db),
    db
      .collection<Corporation>("corporations")
      .find(
        {},
        { projection: { _id: 1, shareholders: 1, totalShares: 1, superShareMultiplier: 1 } }
      )
      .toArray(),
  ]);

  const targetParent = getControllingCorporateParent(target);
  const targetControlsOthers = allCorps.some((corp) => {
    if (corp._id.equals(target._id)) return false;
    const controller = getControllingCorporateParent(corp);
    return controller != null && controller.corporationId.equals(target._id);
  });

  // One-person rule. An NPP seat (caretaker or spawned) occupies no human seat;
  // a caretaker's displaced human is gated later, on reclaim.
  let ceoConflict: SubsidiaryAcquisitionFacts["ceoConflict"] = null;
  const humanRun = target.ceoType !== "npp" && target.ceoVacant !== true && target.userId != null;
  if (humanRun && target.userId.toString() !== SYSTEM_USER_ID && acquirer.userId) {
    const [parentCeoUserId, siblingCeoUserIds] = await Promise.all([
      resolveParentCeoUserId(db, acquirer),
      collectSiblingSubsidiaryCeoUserIds(db, acquirer._id, target._id),
    ]);
    ceoConflict = subsidiaryCeoBlockReason({
      candidateUserId: target.userId,
      parentOwnerUserId: acquirer.userId,
      parentCeoUserId,
      siblingSubsidiaryCeoUserIds: siblingCeoUserIds,
    });
  }

  return {
    featureEnabled,
    acquirerStateOwned: acquirer.countryOwnerId != null || acquirer.ownershipState === "stateOwned",
    acquirerIsFormalizedSubsidiary: acquirer.subsidiaryFormalizedAtTurn != null,
    targetStateOwned: !isEligibleAsSubsidiary(target),
    targetHasOtherControllingParent:
      targetParent != null && !targetParent.corporationId.equals(acquirer._id),
    targetIsFormalizedSubsidiary: target.subsidiaryFormalizedAtTurn != null,
    targetControlsOtherCorporations: targetControlsOthers,
    wouldCreateOwnershipCycle: wouldCreateOwnershipCycle(acquirer, target, allCorps),
    ceoConflict,
  };
}

export type SubsidiaryCheck = { ok: true } | ({ ok: false } & SubsidiaryBlock);

/**
 * Can `acquirer` buy `target` and keep it as a subsidiary right now? Run at
 * propose time (so the proposer sees the refusal before committing a price) and
 * again at execution (the world may have moved).
 */
export async function checkSubsidiaryAcquisition(
  db: Db,
  acquirer: Corporation,
  target: Corporation
): Promise<SubsidiaryCheck> {
  const block = subsidiaryAcquisitionBlock(await gatherFacts(db, acquirer, target));
  return block ? { ok: false, ...block } : { ok: true };
}

/**
 * True when the target's cap table already is the acquirer's alone, with the
 * formalization marker set: the structural write of an interrupted run landed.
 * Callers pair this with a live settlement for the offer, because a target the
 * acquirer already wholly owned before any offer must not read as "done".
 */
export function equityAlreadyTransferred(target: Corporation, acquirerId: ObjectId): boolean {
  return (
    target.subsidiaryFormalizedAtTurn != null &&
    holdsWholeCapTable(target.shareholders ?? [], acquirerId.toString(), target.totalShares ?? 0)
  );
}

/**
 * The structural write: the acquirer becomes the target's only shareholder and
 * the target is formalized as its subsidiary, in one atomic document write
 * guarded by the settlement claim. Idempotent: a replay writes the same state.
 *
 * Everything that only made sense while the target had outside holders goes:
 * the public float (its holders were just paid), a pending share issuance, and
 * any dual-class structure. The target's sectors, cash, bonds, bank charter,
 * identity and CEO are untouched.
 */
export async function transferTargetEquityToAcquirer(
  db: Db,
  input: {
    targetId: ObjectId;
    acquirerId: ObjectId;
    offerId: ObjectId;
    priceAnchor: number;
    turn: number;
    now: Date;
  }
): Promise<boolean> {
  const corps = db.collection<Corporation>("corporations");
  const current = await corps.findOne(
    { _id: input.targetId, acquisitionSettlementId: input.offerId },
    { projection: { totalShares: 1 } }
  );
  if (!current) return false;
  const position = wholeCorporationPosition({
    totalShares: current.totalShares ?? 0,
    priceAnchor: input.priceAnchor,
  });
  // The share count is part of the filter: a corporation that issued or retired
  // shares between the read and the write is left alone and the caller retries.
  const res = await corps.updateOne(
    {
      _id: input.targetId,
      acquisitionSettlementId: input.offerId,
      totalShares: current.totalShares,
    },
    {
      $set: {
        shareholders: [{ corporationId: input.acquirerId, ...position }],
        publicFloat: 0,
        subsidiaryFormalizedAtTurn: input.turn,
        updatedAt: input.now,
      },
      $unset: {
        pendingShareIssuance: "",
        superShareMultiplier: "",
        superSharesAdoptedAtTurn: "",
      },
    }
  );
  if (res.matchedCount !== 1) return false;
  // Index funds keep no position in a corporation nobody else can own. Paid
  // holdings were pulled with their payout leg; this only sweeps dust holdings
  // whose payout rounded to nothing, so no fund is left holding phantom shares.
  await db.collection("indexFunds").updateMany({ "holdings.corporationId": input.targetId }, {
    $pull: { holdings: { corporationId: input.targetId } },
  } as never);
  return true;
}
