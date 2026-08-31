/**
 * Merger-review lifecycle: the authority's decision, the deadline fallback, and
 * the divestiture remedy from order to discharge.
 *
 * The deadline fallback is deterministic and published (see `autoResolveDecision`
 * and the bands in `constants.ts`). A player can read off the card what happens
 * if the seat stays silent, which is the difference between a review and a coin
 * flip.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { MergerReview, PendingDivestiture } from "@/lib/db/types/mergerReview";
import type { CountryId } from "@/lib/constants/countries";
import { createNotification } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit/recordAudit";
import { creditTreasuryProceedsFromAnchor } from "@/lib/nationalization/treasury";
import { atomicallyDebitCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { MERGER_REVIEWS } from "./gate";
import { controlledGroupIds, settleDivestitureIfSatisfied } from "./divestiture";
import { loadIndustryBasis } from "../corpMarketShare";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import {
  autoResolveDecision,
  MERGER_REMEDY_OVERDUE_FINE_RATE,
  MERGER_REMEDY_TURNS,
  type MergerReviewDecision,
} from "./constants";

export type LifecycleResult<T = object> =
  { ok: false; error: string; status: number } | ({ ok: true } & T);

async function notifyParties(
  db: Db,
  review: MergerReview,
  title: string,
  message: string
): Promise<void> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: [review.acquirerCorporationId, review.targetCorporationId] } })
    .project<{ _id: ObjectId; userId?: ObjectId }>({ userId: 1 })
    .toArray();
  for (const corp of corps) {
    if (!corp.userId) continue;
    void createNotification({
      userId: corp.userId,
      type: "merger_review_decided",
      title,
      message,
      metadata: {
        mergerReviewId: review._id.toHexString(),
        corporationId: review.acquirerCorporationId.toHexString(),
      },
    });
  }
}

/**
 * Hand down a decision. `decidedByCharacterId` is the seated officeholder when a
 * player decided; omit it for the deadline path, which stamps `resolvedBy:
 * "deadline"` instead.
 */
export async function decideMergerReview(
  db: Db,
  input: {
    review: MergerReview;
    decision: MergerReviewDecision;
    currentTurn: number;
    decidedByCharacterId?: ObjectId;
    decisionNote?: string;
  }
): Promise<LifecycleResult<{ review: MergerReview }>> {
  const { review, decision, currentTurn, decidedByCharacterId, decisionNote } = input;
  if (review.status !== "pending")
    return { ok: false, error: "This review has already been decided", status: 409 };

  const now = new Date();
  const set: Partial<MergerReview> = {
    status: decision,
    resolvedAtTurn: currentTurn,
    resolvedBy: decidedByCharacterId ? "authority" : "deadline",
    updatedAt: now,
  };
  if (decidedByCharacterId) set.decidedByCharacterId = decidedByCharacterId;
  if (decisionNote) set.decisionNote = decisionNote;
  // The remedy is always the industry that tripped the threshold. Letting the
  // authority pick a different one would let a friendly officeholder order the
  // divestiture of something harmless and call the problem solved.
  if (decision === "clearedWithRemedy") set.remedySectorType = review.leadSectorType;

  // Atomic claim on the pending→decided transition, so two officeholders (or a
  // decision racing the deadline sweep) cannot both resolve it.
  const claim = await db
    .collection<MergerReview>(MERGER_REVIEWS)
    .updateOne({ _id: review._id, status: "pending" }, { $set: set });
  if (claim.matchedCount === 0)
    return { ok: false, error: "This review has already been decided", status: 409 };

  const decided = { ...review, ...set } as MergerReview;

  const headline =
    decision === "blocked"
      ? "Merger blocked"
      : decision === "clearedWithRemedy"
        ? "Merger cleared with conditions"
        : "Merger cleared";
  const body =
    decision === "blocked"
      ? `${review.acquirerName}'s acquisition of ${review.targetName} was blocked on competition grounds.`
      : decision === "clearedWithRemedy"
        ? `${review.acquirerName}'s acquisition of ${review.targetName} may proceed, on condition that the combined firm divests its ${review.leadSectorType} business within ${MERGER_REMEDY_TURNS} turns of completion.`
        : `${review.acquirerName}'s acquisition of ${review.targetName} was cleared.`;
  await notifyParties(db, decided, headline, body);

  recordAudit({
    source: decidedByCharacterId ? "api" : "turn",
    action: "merger.review.decide",
    category: "corp",
    turn: currentTurn,
    ts: now,
    subject: { type: "corporation", id: review.acquirerCorporationId, name: review.acquirerName },
    refs: { corporationId: review.acquirerCorporationId },
    outcome: "ok",
    meta: {
      mergerReviewId: review._id,
      decision,
      resolvedBy: set.resolvedBy,
      combinedSharePercent: review.combinedSharePercent,
      thresholdPercent: review.thresholdPercent,
      countryId: review.countryId,
    },
  });

  return { ok: true, review: decided };
}

/**
 * Turn phase: resolve every review whose deadline has passed, on the published
 * bands. Idempotent — a review the authority already decided is no longer
 * pending and is skipped.
 */
export async function resolveDueMergerReviews(
  db: Db,
  currentTurn: number
): Promise<{ resolved: number }> {
  const due = await db
    .collection<MergerReview>(MERGER_REVIEWS)
    .find({ status: "pending", decideByTurn: { $lte: currentTurn } })
    .toArray();
  let resolved = 0;
  for (const review of due) {
    const decision = autoResolveDecision(review.combinedSharePercent, review.thresholdPercent);
    const result = await decideMergerReview(db, { review, decision, currentTurn });
    if (result.ok) resolved += 1;
  }
  return { resolved };
}

/**
 * Attach the divestiture obligation to the acquirer once a remedied deal has
 * actually completed. Called by the executors AFTER the merge commits — an
 * obligation attached at decision time would bind a deal that never happened.
 */
export async function attachMergerRemedy(
  db: Db,
  review: MergerReview,
  acquirerId: ObjectId,
  currentTurn: number
): Promise<void> {
  if (review.status !== "clearedWithRemedy" || !review.remedySectorType) return;
  const obligation: PendingDivestiture = {
    reviewId: review._id,
    sectorType: review.remedySectorType,
    dueTurn: currentTurn + MERGER_REMEDY_TURNS,
    thresholdPercent: review.thresholdPercent,
    countryId: review.countryId,
  };
  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: acquirerId },
      { $set: { pendingDivestiture: obligation, updatedAt: new Date() } }
    );
}

/**
 * Turn phase: fine every corporation sitting on an overdue divestiture.
 *
 * The fine is a fraction of the ₳ revenue the corp still earns in the industry
 * it was ordered to leave, so ignoring the order costs more the more valuable
 * the thing being kept is. Paid to the reviewing country's treasury. An overdue
 * corp is also barred from opening new acquisitions (enforced at the propose
 * and takeover gates).
 */
export async function fineOverdueDivestitures(
  db: Db,
  currentTurn: number
): Promise<{ fined: number; totalAnchor: number }> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ "pendingDivestiture.dueTurn": { $lt: currentTurn } })
    .toArray();
  if (corps.length === 0) return { fined: 0, totalAnchor: 0 };

  const now = new Date();
  let fined = 0;
  let totalAnchor = 0;
  for (const corp of corps) {
    const obligation = corp.pendingDivestiture;
    if (!obligation) continue;
    // Re-measure first: the group may have sold down since the order was made,
    // by spin-off-and-sale or any other route. A satisfied order is discharged
    // rather than fined.
    if (await settleDivestitureIfSatisfied(db, corp)) continue;

    // Fine base is the whole CONTROLLED GROUP's ₳ revenue in that industry IN
    // THE REVIEWING COUNTRY. Not just the parent's own sectors: otherwise
    // pushing the business down into a subsidiary — the exact arrangement the
    // order exists to undo — would zero the fine while leaving the market as
    // concentrated as it was. Read off the same country-scoped, ₳-normalized
    // rollup the review measured, so the fine and the finding agree.
    const byType = await loadIndustryBasis(
      db,
      obligation.countryId as CountryId,
      [obligation.sectorType],
      marketAtLeast(await getMarketSystemModeForDb(db), "plants")
    );
    const basis = byType.get(obligation.sectorType);
    if (!basis) continue;
    const group = await controlledGroupIds(db, corp._id);
    let groupRevenueAnchor = 0;
    for (const [corpId, anchor] of basis.anchorByCorp) {
      if (group.has(corpId)) groupRevenueAnchor += anchor;
    }
    if (groupRevenueAnchor <= 0) continue;

    const fxRate = await getCorpFxRate(db, corp);
    const fineLocal = Math.round(
      anchorToCorpLiquidCapital(groupRevenueAnchor * MERGER_REMEDY_OVERDUE_FINE_RATE, corp, fxRate)
    );
    if (fineLocal <= 0) continue;

    const debit = await atomicallyDebitCorpLiquidCapital(db, corp._id, fineLocal);
    if (!debit.ok) continue; // Cannot pay this turn; the order stands and it is retried next turn.

    // The fine was DEBITED in the corporation's currency, but the reviewing
    // country's treasury keeps its books in its OWN currency. Credit the ₳
    // amount converted for the receiving country, not the payer's local figure
    // — otherwise a cross-border acquirer over- or under-pays the government by
    // the exchange-rate difference (#808).
    await creditTreasuryProceedsFromAnchor(
      db,
      obligation.countryId as CountryId,
      corpLiquidCapitalToAnchor(fineLocal, corp, fxRate),
      now
    );
    await emitTx(db, {
      type: "corp_fine",
      turn: currentTurn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: corp._id,
      subjectName: corp.name,
      amount: -fineLocal,
      currencyCode: (resolveCorpLiquidCurrencyCode(corp) ?? "USD") as CurrencyCode,
      counterpartyType: "government",
      counterpartyName: obligation.countryId,
      meta: {
        kind: "merger_divestiture_overdue",
        mergerReviewId: obligation.reviewId.toString(),
        sectorType: obligation.sectorType,
      },
    });
    fined += 1;
    totalAnchor += corpLiquidCapitalToAnchor(fineLocal, corp, fxRate);

    if (corp.userId) {
      void createNotification({
        userId: corp.userId,
        type: "merger_remedy_overdue",
        title: "Divestiture overdue",
        message: `${corp.name} has not divested its ${obligation.sectorType} business as ordered. A fine of ${fineLocal.toLocaleString()} was levied and it cannot open new acquisitions until the order is met.`,
        metadata: {
          corporationId: corp._id.toHexString(),
          mergerReviewId: obligation.reviewId.toHexString(),
        },
      });
    }
  }
  return { fined, totalAnchor: Math.round(totalAnchor) };
}
