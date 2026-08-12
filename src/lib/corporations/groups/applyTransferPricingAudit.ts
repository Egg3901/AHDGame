/**
 * Accrue transfer-pricing exposure on intra-group cross-border supply
 * agreements, and assess the ones that cross the threshold.
 *
 * Exposure lives on the agreement document (`transferPricingExposureAnchor`),
 * so a position that is unwound before it matures simply stops accruing — the
 * player who prices aggressively for a few turns and then returns to market has
 * taken a real risk and got away with it, which is the intended shape.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { SettledPremium } from "@/lib/turn/corporation/settleSupplyAgreements";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { atomicallyDebitCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import { creditTreasuryProceeds } from "@/lib/nationalization/treasury";
import { createNotification } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit/recordAudit";
import { resolveFormalizedGroups } from "./groupMembership";
import {
  assessIfDue,
  isTransferPricingPosition,
  shiftDirection,
  type IntraGroupPosition,
} from "./transferPricing";

const AGREEMENTS = "supplyAgreements";

export interface TransferPricingResult {
  positionsTracked: number;
  auditsAssessed: number;
  totalAssessedAnchor: number;
  errors: string[];
}

export async function applyTransferPricingAudit(
  db: Db,
  settledPremiums: SettledPremium[],
  corporateTaxRateByCountry: ReadonlyMap<string, number>,
  currentTurn: number,
  now: Date
): Promise<TransferPricingResult> {
  const result: TransferPricingResult = {
    positionsTracked: 0,
    auditsAssessed: 0,
    totalAssessedAnchor: 0,
    errors: [],
  };
  if (settledPremiums.length === 0) return result;

  const membership = await resolveFormalizedGroups(db);
  if (membership.membersByRootId.size === 0) return result;

  const corpIds = new Set<string>();
  for (const p of settledPremiums) {
    corpIds.add(p.supplierCorpId);
    corpIds.add(p.buyerCorpId);
  }
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: [...corpIds].map((id) => new ObjectId(id)) } })
    .project<Pick<Corporation, "_id" | "name" | "countryId" | "userId" | "liquidCurrencyCode">>({
      name: 1,
      countryId: 1,
      userId: 1,
      liquidCurrencyCode: 1,
    })
    .toArray();
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  for (const premium of settledPremiums) {
    const supplier = corpById.get(premium.supplierCorpId);
    const buyer = corpById.get(premium.buyerCorpId);
    if (!supplier || !buyer) continue;

    const sameGroup =
      membership.rootByCorpId.get(premium.supplierCorpId) ===
      membership.rootByCorpId.get(premium.buyerCorpId);

    const position: IntraGroupPosition = {
      agreementId: premium.agreementId,
      supplierCorpId: premium.supplierCorpId,
      buyerCorpId: premium.buyerCorpId,
      supplierCountryId: supplier.countryId,
      buyerCountryId: buyer.countryId,
      pricePremium: premium.pricePremium,
      premiumAnchor: premium.premiumAnchor,
    };
    if (!isTransferPricingPosition(position, sameGroup)) continue;

    const shift = shiftDirection(position);
    if (!shift) continue;
    result.positionsTracked += 1;

    // Accrue first, then read back the running total, so two settlements in the
    // same turn on the same agreement cannot both miss the threshold.
    const accrued = await db.collection<SupplyAgreement>(AGREEMENTS).findOneAndUpdate(
      { _id: new ObjectId(premium.agreementId) },
      {
        $inc: { transferPricingExposureAnchor: shift.shiftedBaseAnchor },
        $set: { updatedAt: now },
      },
      { returnDocument: "after", projection: { transferPricingExposureAnchor: 1 } }
    );
    const exposure = accrued?.transferPricingExposureAnchor ?? 0;

    const rate = corporateTaxRateByCountry.get(shift.claimantCountryId);
    const assessment = assessIfDue({
      agreementId: premium.agreementId,
      gainerCorpId: shift.gainerCorpId,
      claimantCountryId: shift.claimantCountryId,
      accruedExposureAnchor: exposure,
      effectiveTaxRate: (rate ?? 0) / 100,
    });
    if (!assessment) continue;

    const liable = corpById.get(assessment.liableCorpId);
    if (!liable) continue;

    try {
      const fxRate = await getCorpFxRate(db, liable as Corporation);
      const localAmount = Math.round(
        anchorToCorpLiquidCapital(assessment.assessmentAnchor, liable as Corporation, fxRate)
      );
      if (localAmount <= 0) continue;

      // An unaffordable assessment is not waived — it is taken as far as the
      // balance goes and the exposure clock resets either way, so a corp cannot
      // dodge by running its cash down.
      const debit = await atomicallyDebitCorpLiquidCapital(db, liable._id, localAmount);
      const collected = debit.ok ? localAmount : 0;
      if (collected > 0) {
        await creditTreasuryProceeds(
          db,
          assessment.claimantCountryId as CountryId,
          collected,
          now
        );
        await emitTx(db, {
          type: "corp_fine",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: liable._id,
          subjectName: liable.name,
          amount: -collected,
          currencyCode: (resolveCorpLiquidCurrencyCode(liable as Corporation) ??
            "USD") as CurrencyCode,
          counterpartyType: "government",
          counterpartyName: `${assessment.claimantCountryId} treasury`,
          meta: {
            kind: "transfer_pricing_assessment",
            agreementId: premium.agreementId,
            shiftedBaseAnchor: Math.round(assessment.shiftedBaseAnchor),
            assessmentAnchor: assessment.assessmentAnchor,
          },
        });
      }

      await db
        .collection<SupplyAgreement>(AGREEMENTS)
        .updateOne(
          { _id: new ObjectId(premium.agreementId) },
          {
            $set: {
              transferPricingExposureAnchor: 0,
              lastTransferPricingAuditTurn: currentTurn,
              updatedAt: now,
            },
          }
        );

      if (liable.userId) {
        void createNotification({
          userId: liable.userId,
          type: "transfer_pricing_assessed",
          title: "Transfer pricing assessment",
          message: `${assessment.claimantCountryId} reassessed ${liable.name}'s intra-group contract pricing at arm's length. ₳${Math.round(assessment.shiftedBaseAnchor).toLocaleString()} of shifted profit was reassessed, with a surcharge.`,
          metadata: { corporationId: liable._id.toHexString() },
        });
      }

      recordAudit({
        source: "turn",
        action: "corp.transfer_pricing_assessment",
        category: "corp",
        turn: currentTurn,
        ts: now,
        subject: { type: "corporation", id: liable._id, name: liable.name },
        refs: { corporationId: liable._id },
        outcome: "ok",
        meta: {
          agreementId: premium.agreementId,
          claimantCountryId: assessment.claimantCountryId,
          shiftedBaseAnchor: Math.round(assessment.shiftedBaseAnchor),
          assessmentAnchor: assessment.assessmentAnchor,
          collectedLocal: collected,
        },
      });

      result.auditsAssessed += 1;
      result.totalAssessedAnchor += assessment.assessmentAnchor;
    } catch (err) {
      result.errors.push(
        `transfer pricing ${premium.agreementId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
