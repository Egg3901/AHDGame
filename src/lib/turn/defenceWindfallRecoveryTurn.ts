import { ObjectId, type Db } from "mongodb";
import { applyMoneyMove } from "@/lib/banking/moneyMove";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import {
  DEFECT_ID,
  computeRecoveryTranche,
  readWindfallMarker,
  type WindfallMarker,
} from "@/lib/remediation/defects/AHD-defence-supplier-windfall";

const MARKER_PATH = `remediation.${DEFECT_ID}`;

interface RecoveringCorporation {
  _id: ObjectId;
  name: string;
  liquidCapital: number;
  remediation?: Record<string, unknown>;
}

export interface DefenceWindfallRecoveryTurnResult {
  corporationsAssessed: number;
  amountRecovered: number;
}

export async function processDefenceWindfallRecoveryTurn(
  db: Db,
  turn: number,
  now = new Date()
): Promise<DefenceWindfallRecoveryTurnResult> {
  const corporations = await db
    .collection<RecoveringCorporation>("corporations")
    .find({ [`${MARKER_PATH}.outstandingAmount`]: { $gt: 0 } })
    .toArray();
  let amountRecovered = 0;
  const receipts: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];

  for (const corporation of corporations) {
    const marker = readWindfallMarker(corporation);
    if (!marker || marker.lastSweepTurn === turn) continue;
    const recovery = computeRecoveryTranche(
      corporation.liquidCapital,
      marker.outstandingAmount,
      marker.operatingReserve
    );
    if (!(recovery > 0)) continue;
    const nextOutstanding = Math.max(
      0,
      Math.round((marker.outstandingAmount - recovery) * 100) / 100
    );
    const nextMarker: WindfallMarker = {
      ...marker,
      recoveredAmount: Math.round((marker.recoveredAmount + recovery) * 100) / 100,
      outstandingAmount: nextOutstanding,
      lastSweepTurn: turn,
      ...(nextOutstanding === 0 ? { settledAt: now } : {}),
    };
    const move = await applyMoneyMove(db, {
      key: `${DEFECT_ID}:sweep:${corporation._id.toString()}:${turn}`,
      kind: "defence-windfall-recovery",
      turn,
      legs: [
        {
          kind: "debit",
          amount: recovery,
          collection: "corporations",
          filter: {
            _id: corporation._id,
            [`${MARKER_PATH}.outstandingAmount`]: marker.outstandingAmount,
            [`${MARKER_PATH}.lastSweepTurn`]: { $ne: turn },
            liquidCapital: { $gte: recovery + marker.operatingReserve },
          },
          path: "liquidCapital",
          set: { [MARKER_PATH]: nextMarker, updatedAt: now },
          note: "supplier pays the staged legacy defence windfall assessment",
        },
        {
          kind: "credit",
          amount: recovery,
          collection: "federalBudget",
          filter: { countryId: marker.countryId },
          path: "defenseAppropriation.balance",
          set: { updatedAt: now },
          note: "defence appropriation receives a staged supplier recovery",
        },
      ],
    });
    if (move.status === "rejected" || move.status === "partial") {
      throw new Error(
        `staged windfall recovery failed for ${corporation._id.toString()}: ${move.error ?? move.status}`
      );
    }
    if (move.status !== "applied") continue;
    amountRecovered += recovery;
    receipts.push({
      type: "admin_transfer",
      turn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: corporation._id,
      subjectName: corporation.name,
      amount: -recovery,
      currencyCode: "USD",
      counterpartyType: "government",
      counterpartyName: `${marker.countryId} defence appropriation`,
      meta: {
        defectId: DEFECT_ID,
        side: "staged_recovery",
        outstandingAmount: nextOutstanding,
      },
    });
    receipts.push({
      type: "admin_transfer",
      turn,
      createdAt: now,
      subjectType: "government",
      countryId: marker.countryId,
      subjectName: `${marker.countryId} Government`,
      amount: recovery,
      currencyCode: "USD",
      counterpartyType: "corporation",
      counterpartyName: corporation.name,
      meta: {
        defectId: DEFECT_ID,
        side: "staged_recovery_credit",
        outstandingAmount: nextOutstanding,
      },
    });
  }

  if (receipts.length > 0) {
    await emitTxBulk(db, receipts, await loadTxThresholds(db));
  }
  return { corporationsAssessed: corporations.length, amountRecovered };
}
