/**
 * IMF facility remittances run after corporation sector processing so per-turn income
 * and liquidCapital already include operating results. Debits the rescued corporation
 * and credits the IMF institution corp (USD balance sheet) using anchor (₳) amounts
 * converted through each corp's home-currency rules.
 * QA: prioritize **JPY** and **GBP** home-currency rescued corps (active forex); do not
 * treat EUR as the main non-USD proxy for this path.
 */

import type { AnyBulkWriteOperation, Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  anchorToCorpLiquidCapital,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import {
  IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION,
  IMF_BAILOUT_INCOME_FRACTION_CAP,
} from "@/lib/imf/constants";
import { computeImfFacilityPaymentTurn } from "@/lib/imf/imfFacilityMath";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";
import type { CorpSnapshot } from "@/lib/turn/corporation/types";

const PRINCIPAL_EPS = 1e-6;

/**
 * Applies IMF facility principal/interest payments for all bailed-out corporations.
 */
export async function processImfBailoutPayments(
  db: Db,
  _turn: number,
  corpSnapshots: CorpSnapshot[],
  corporations: Corporation[]
): Promise<{ paymentsApplied: number }> {
  const imfCorp = await getImfCorporation(db);
  if (!imfCorp) {
    return { paymentsApplied: 0 };
  }

  const incomeByCorpId = new Map<string, number>();
  for (const s of corpSnapshots) {
    incomeByCorpId.set(s.corpId.toString(), s.income);
  }

  const fxByCurrency = await loadFxRatesByCurrency(db);
  const imfFx = fxRateForCorpFromMap(imfCorp, fxByCurrency);

  const ops: AnyBulkWriteOperation<Corporation>[] = [];
  let paymentsApplied = 0;
  const now = new Date();
  const snapshotByCorpId = new Map(corpSnapshots.map((s) => [s.corpId.toString(), s]));

  for (const corp of corporations) {
    if (!corp.imfBailoutActive) continue;
    if (imfCorp._id.equals(corp._id)) continue;

    const principal = corp.imfFacilityPrincipalOutstanding ?? 0;
    if (principal <= PRINCIPAL_EPS) continue;

    const annualRate = corp.imfFacilityAnnualRate ?? 0;
    const remainingTurns = corp.imfFacilityAmortizationTurnsRemaining ?? 48;
    const turnIncome = incomeByCorpId.get(corp._id.toString()) ?? 0;

    const incomeCapFraction = Math.min(
      IMF_BAILOUT_INCOME_FRACTION_CAP,
      corp.imfFacilityIncomeCaptureFraction ?? IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION
    );

    const split = computeImfFacilityPaymentTurn({
      principalOutstanding: principal,
      annualRatePercent: annualRate,
      remainingTurns,
      turnIncome,
      incomeCapFraction,
    });

    const facilityCleared = split.newPrincipal <= PRINCIPAL_EPS;
    const rescuedFx = fxRateForCorpFromMap(corp, fxByCurrency);

    if (split.actualPayment > PRINCIPAL_EPS) {
      paymentsApplied++;
    }

    const debitLocal =
      split.actualPayment > PRINCIPAL_EPS
        ? anchorToCorpLiquidCapital(split.actualPayment, corp, rescuedFx)
        : 0;
    const creditLocal =
      split.actualPayment > PRINCIPAL_EPS
        ? anchorToCorpLiquidCapital(split.actualPayment, imfCorp, imfFx)
        : 0;

    const rescuedUpdate: {
      $inc?: { liquidCapital: number };
      $set: Record<string, unknown>;
      $unset?: Record<string, "" | true>;
    } = {
      $set: {
        imfFacilityPrincipalOutstanding: facilityCleared ? 0 : split.newPrincipal,
        imfFacilityAmortizationTurnsRemaining: facilityCleared ? 0 : split.newRemainingTurns,
        updatedAt: now,
      },
    };

    if (split.actualPayment > PRINCIPAL_EPS) {
      rescuedUpdate.$inc = { liquidCapital: -debitLocal };
    }

    if (facilityCleared) {
      rescuedUpdate.$set.imfBailoutActive = false;
      rescuedUpdate.$set.imfFacilityAnnualRate = 0;
      rescuedUpdate.$unset = {
        imfBailoutImfCorporationId: "",
        imfBailoutTargetOwnershipPercent: "",
        imfFacilityIncomeCaptureFraction: "",
      };
    }

    ops.push({
      updateOne: {
        filter: { _id: corp._id as ObjectId },
        update: rescuedUpdate,
      },
    });

    if (split.actualPayment > PRINCIPAL_EPS) {
      const rescuedSnapshot = snapshotByCorpId.get(corp._id.toString());
      if (rescuedSnapshot) {
        rescuedSnapshot.liquidCapital = Math.max(0, rescuedSnapshot.liquidCapital - debitLocal);
      }
      const imfSnapshot = snapshotByCorpId.get(imfCorp._id.toString());
      if (imfSnapshot) {
        imfSnapshot.liquidCapital += creditLocal;
      }

      ops.push({
        updateOne: {
          filter: { _id: imfCorp._id },
          update: {
            $inc: { liquidCapital: creditLocal },
            $set: { updatedAt: now },
          },
        },
      });
    }
  }

  if (ops.length > 0) {
    await db.collection<Corporation>("corporations").bulkWrite(ops);
  }

  return { paymentsApplied };
}
