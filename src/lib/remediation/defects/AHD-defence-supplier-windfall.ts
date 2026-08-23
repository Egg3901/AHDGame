import { ObjectId, type Db } from "mongodb";
import { applyMoneyMove } from "@/lib/banking/moneyMove";
import type { Corporation } from "@/lib/db/types";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type {
  Defect,
  DetectResult,
  HealContext,
  HealPlan,
  HealResult,
  VerifyResult,
} from "../types";

export const DEFECT_ID = "AHD-defence-supplier-windfall";

const CORPORATION_ID = "6a7ccd0052c9a66f8edfa485";
const COUNTRY_ID = "US";
const MARKER_PATH = `remediation.${DEFECT_ID}`;

export const SOURCE_CONTRACT_IDS = [
  "6a8216f40277deab9c24a35e",
  "6a8261bc4e281e3330143024",
  "6a82bceb8d310ae98679e497",
  "6a83586fb5d78ecf40c1dfa3",
  "6a8421d89201d287c650b06e",
] as const;

export const LEGACY_CONTRACT_GROSS = 11_443_922_106;
export const RECORDED_LEGACY_PRODUCTION_COST = 5_455;
export const RETAINED_MARGIN_RATE = 0.2;
export const OPERATING_RESERVE = 500_000_000;
export const RETAINED_LEGACY_PROFIT = LEGACY_CONTRACT_GROSS * RETAINED_MARGIN_RATE;
export const TOTAL_ASSESSMENT =
  LEGACY_CONTRACT_GROSS - RECORDED_LEGACY_PRODUCTION_COST - RETAINED_LEGACY_PROFIT;

export interface WindfallMarker {
  runId: string | null;
  appliedAt: Date;
  countryId: string;
  currencyCode: "USD";
  sourceContractIds: string[];
  legacyContractGross: number;
  recordedProductionCost: number;
  retainedMarginRate: number;
  retainedLegacyProfit: number;
  assessedAmount: number;
  recoveredAmount: number;
  outstandingAmount: number;
  operatingReserve: number;
  lastSweepTurn?: number;
  settledAt?: Date;
}

interface ContractEvidence {
  _id: ObjectId;
  corporationId: ObjectId;
  countryId: string;
  costBasis?: "margin";
  lotsDelivered: number;
  pricePerLot: number;
  status: string;
  remediation?: Record<string, unknown>;
}

interface BudgetEvidence {
  _id: string | ObjectId;
  countryId: string;
  defenseAppropriation?: { balance?: number };
}

interface CorporationEvidence extends Corporation {
  remediation?: Record<string, unknown>;
}

interface WindfallPlanPayload {
  corporationId: string;
  corporationName: string;
  budgetId: string;
  currentTurn: number;
  immediateRecovery: number;
  marker: WindfallMarker;
}

interface Survey {
  corporation: CorporationEvidence | null;
  budget: BudgetEvidence | null;
  contracts: ContractEvidence[];
  currentTurn: number;
  evidenceMatches: boolean;
  marker: WindfallMarker | null;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeRecoveryTranche(
  liquidCapital: number,
  outstandingAmount: number,
  operatingReserve = OPERATING_RESERVE
): number {
  return roundCents(
    Math.min(Math.max(0, outstandingAmount), Math.max(0, liquidCapital - operatingReserve))
  );
}

export function readWindfallMarker(doc: {
  remediation?: Record<string, unknown>;
}): WindfallMarker | null {
  const marker = doc.remediation?.[DEFECT_ID];
  if (!marker || typeof marker !== "object") return null;
  const row = marker as Partial<WindfallMarker>;
  if (
    typeof row.assessedAmount !== "number" ||
    typeof row.recoveredAmount !== "number" ||
    typeof row.outstandingAmount !== "number" ||
    typeof row.operatingReserve !== "number"
  ) {
    return null;
  }
  return marker as WindfallMarker;
}

function contractEvidenceMatches(contracts: ContractEvidence[]): boolean {
  if (contracts.length !== SOURCE_CONTRACT_IDS.length) return false;
  const byId = new Map(contracts.map((row) => [row._id.toString(), row]));
  const expected: Record<string, { lots: number; price: number }> = {
    "6a8216f40277deab9c24a35e": { lots: 6, price: 379_940_911 },
    "6a8261bc4e281e3330143024": { lots: 6, price: 379_940_911 },
    "6a82bceb8d310ae98679e497": { lots: 6, price: 379_940_911 },
    "6a83586fb5d78ecf40c1dfa3": { lots: 6, price: 383_748_809 },
    "6a8421d89201d287c650b06e": { lots: 6, price: 383_748_809 },
  };
  return SOURCE_CONTRACT_IDS.every((id) => {
    const row = byId.get(id);
    const want = expected[id];
    return (
      row?.corporationId.toString() === CORPORATION_ID &&
      row.countryId === COUNTRY_ID &&
      row.costBasis !== "margin" &&
      row.status === "complete" &&
      row.lotsDelivered === want.lots &&
      row.pricePerLot === want.price
    );
  });
}

async function survey(db: Db): Promise<Survey> {
  const corporationId = new ObjectId(CORPORATION_ID);
  const [corporation, budget, contracts, gameState] = await Promise.all([
    db.collection<CorporationEvidence>("corporations").findOne({ _id: corporationId }),
    db.collection<BudgetEvidence>("federalBudget").findOne({ countryId: COUNTRY_ID }),
    db
      .collection<ContractEvidence>("defenceContracts")
      .find({ _id: { $in: SOURCE_CONTRACT_IDS.map((id) => new ObjectId(id)) } })
      .toArray(),
    db.collection<{ currentTurn?: number }>("gameState").findOne({}),
  ]);
  return {
    corporation,
    budget,
    contracts,
    currentTurn: gameState?.currentTurn ?? 0,
    evidenceMatches: contractEvidenceMatches(contracts),
    marker: corporation ? readWindfallMarker(corporation) : null,
  };
}

async function detect(db: Db): Promise<DetectResult> {
  const state = await survey(db);
  const missing = [
    ...(state.corporation ? [] : ["supplier corporation"]),
    ...(state.budget ? [] : ["US federal budget"]),
    ...(state.evidenceMatches ? [] : ["five pinned legacy contracts"]),
  ];
  const affected = missing.length === 0 && !state.marker ? 1 : 0;
  return {
    affected,
    sample: affected
      ? [
          {
            corporationId: CORPORATION_ID,
            legacyContractGross: LEGACY_CONTRACT_GROSS,
            retainedMarginRate: RETAINED_MARGIN_RATE,
            assessment: TOTAL_ASSESSMENT,
            liquidCapital: state.corporation?.liquidCapital,
          },
        ]
      : [],
    notes: [
      ...missing,
      state.marker
        ? `settlement marker present with ${state.marker.outstandingAmount.toLocaleString("en-US")} outstanding`
        : "settlement marker absent",
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const state = await survey(db);
  if (state.marker) {
    return {
      affected: 0,
      touched: [],
      moneyDelta: 0,
      summary: `${DEFECT_ID}: initial assessment already applied`,
      notes: [`${state.marker.outstandingAmount.toLocaleString("en-US")} remains staged`],
    };
  }
  if (!state.corporation || !state.budget || !state.evidenceMatches) {
    throw new Error(`${DEFECT_ID} cannot prove the pinned production evidence`);
  }
  const immediateRecovery = computeRecoveryTranche(
    state.corporation.liquidCapital,
    TOTAL_ASSESSMENT
  );
  if (!(immediateRecovery > 0)) {
    throw new Error(`${DEFECT_ID} cannot collect an initial tranche above the operating reserve`);
  }
  const marker: WindfallMarker = {
    runId: null,
    appliedAt: new Date(0),
    countryId: COUNTRY_ID,
    currencyCode: "USD",
    sourceContractIds: [...SOURCE_CONTRACT_IDS],
    legacyContractGross: LEGACY_CONTRACT_GROSS,
    recordedProductionCost: RECORDED_LEGACY_PRODUCTION_COST,
    retainedMarginRate: RETAINED_MARGIN_RATE,
    retainedLegacyProfit: RETAINED_LEGACY_PROFIT,
    assessedAmount: TOTAL_ASSESSMENT,
    recoveredAmount: immediateRecovery,
    outstandingAmount: roundCents(TOTAL_ASSESSMENT - immediateRecovery),
    operatingReserve: OPERATING_RESERVE,
  };
  const payload: WindfallPlanPayload = {
    corporationId: CORPORATION_ID,
    corporationName: state.corporation.name,
    budgetId: state.budget._id.toString(),
    currentTurn: state.currentTurn,
    immediateRecovery,
    marker,
  };
  return {
    affected: 1,
    touched: [
      { collection: "corporations", ids: [CORPORATION_ID] },
      { collection: "federalBudget", ids: [payload.budgetId] },
      { collection: "defenceContracts", ids: [...SOURCE_CONTRACT_IDS] },
    ],
    moneyDelta: 0,
    summary:
      `recover ${immediateRecovery.toLocaleString("en-US")} USD now from the legacy defence ` +
      `windfall, retain 20%, preserve a ${OPERATING_RESERVE.toLocaleString("en-US")} USD reserve, ` +
      `and stage ${marker.outstandingAmount.toLocaleString("en-US")} USD`,
    notes: [
      "The five pinned legacy contracts are the complete assessment basis.",
      "Cost-aware contracts and ordinary investment returns are untouched.",
      "The recurring turn sweep collects only cash above the operating reserve.",
      "No shares, bonds, sectors, prices, or price history are rewritten.",
    ],
    payload,
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const payload = healPlan.payload as WindfallPlanPayload | undefined;
  if (!payload || healPlan.affected === 0) {
    return { documentsScanned: 0, documentsUpdated: 0, notes: ["nothing to heal"] };
  }
  const marker: WindfallMarker = {
    ...payload.marker,
    runId: ctx.runId ?? null,
    appliedAt: ctx.now,
  };
  const move = await applyMoneyMove(db, {
    key: `${DEFECT_ID}:initial:${ctx.runId ?? "missing-run"}`,
    kind: "defence-windfall-recovery",
    turn: payload.currentTurn,
    legs: [
      {
        kind: "debit",
        amount: payload.immediateRecovery,
        collection: "corporations",
        filter: {
          _id: new ObjectId(payload.corporationId),
          [MARKER_PATH]: { $exists: false },
          liquidCapital: { $gte: payload.immediateRecovery + OPERATING_RESERVE },
        },
        path: "liquidCapital",
        set: { [MARKER_PATH]: marker, updatedAt: ctx.now },
        note: "supplier returns the assessed legacy defence windfall above its operating reserve",
      },
      {
        kind: "credit",
        amount: payload.immediateRecovery,
        collection: "federalBudget",
        filter: { _id: payload.budgetId, countryId: COUNTRY_ID },
        path: "defenseAppropriation.balance",
        set: { updatedAt: ctx.now },
        note: "US defence appropriation receives the legacy supplier recovery",
      },
    ],
  });
  if (move.status !== "applied" && move.status !== "replayed") {
    throw new Error(`initial windfall recovery did not settle: ${move.error ?? move.status}`);
  }

  let contractsMarked = 0;
  for (const contractId of SOURCE_CONTRACT_IDS) {
    const result = await db.collection<ContractEvidence>("defenceContracts").updateOne(
      { _id: new ObjectId(contractId), [`${MARKER_PATH}.runId`]: { $ne: ctx.runId ?? null } },
      {
        $set: {
          [MARKER_PATH]: {
            runId: ctx.runId ?? null,
            appliedAt: ctx.now,
            retainedMarginRate: RETAINED_MARGIN_RATE,
          },
        },
      }
    );
    contractsMarked += result.modifiedCount;
  }

  const thresholds = await loadTxThresholds(db);
  await emitTxBulk(
    db,
    [
      {
        type: "admin_transfer" as const,
        turn: payload.currentTurn,
        createdAt: ctx.now,
        subjectType: "corporation" as const,
        subjectId: new ObjectId(payload.corporationId),
        subjectName: payload.corporationName,
        amount: -payload.immediateRecovery,
        currencyCode: "USD" as const,
        counterpartyType: "government" as const,
        counterpartyName: "US defence appropriation",
        meta: {
          defectId: DEFECT_ID,
          runId: ctx.runId ?? null,
          side: "initial_recovery",
          outstandingAmount: marker.outstandingAmount,
        },
      },
      {
        type: "admin_transfer" as const,
        turn: payload.currentTurn,
        createdAt: ctx.now,
        subjectType: "government" as const,
        countryId: COUNTRY_ID,
        subjectName: "US Government",
        amount: payload.immediateRecovery,
        currencyCode: "USD" as const,
        counterpartyType: "corporation" as const,
        counterpartyName: payload.corporationName,
        meta: {
          defectId: DEFECT_ID,
          runId: ctx.runId ?? null,
          side: "initial_recovery_credit",
          outstandingAmount: marker.outstandingAmount,
        },
      },
    ],
    thresholds
  );
  const inserted = ctx.runId
    ? await db
        .collection<FinancialTxLogEntry>("financialTxLog")
        .find({ type: "admin_transfer", "meta.runId": ctx.runId }, { projection: { _id: 1 } })
        .toArray()
    : [];
  return {
    documentsScanned: 1 + SOURCE_CONTRACT_IDS.length,
    documentsUpdated: 2 + contractsMarked,
    insertedIds:
      inserted.length > 0
        ? [{ collection: "financialTxLog", ids: inserted.map((row) => row._id.toString()) }]
        : undefined,
    notes: [
      `recovered ${payload.immediateRecovery.toLocaleString("en-US")} USD without changing total money`,
      `staged ${marker.outstandingAmount.toLocaleString("en-US")} USD for excess-cash sweeps`,
      `marked ${contractsMarked} source contracts`,
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const state = await survey(db);
  const marker = state.marker;
  const markedContracts = state.contracts.filter(
    (row) => row.remediation?.[DEFECT_ID] !== undefined
  ).length;
  const arithmeticOk =
    marker != null &&
    Math.abs(marker.recoveredAmount + marker.outstandingAmount - marker.assessedAmount) < 0.01;
  const ok =
    marker != null &&
    arithmeticOk &&
    state.evidenceMatches &&
    markedContracts === SOURCE_CONTRACT_IDS.length;
  return {
    ok,
    remaining: ok ? 0 : 1,
    notes: [
      marker
        ? `${marker.recoveredAmount.toLocaleString("en-US")} recovered and ${marker.outstandingAmount.toLocaleString("en-US")} outstanding`
        : "settlement marker missing",
      `${markedContracts} of ${SOURCE_CONTRACT_IDS.length} source contracts marked`,
      arithmeticOk ? "assessment arithmetic balances" : "assessment arithmetic does not balance",
    ],
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "Legacy defence supplier retained a near-zero-cost procurement windfall",
  severity: "P1",
  codeFix: {
    pr: 520,
    mergedTo: "main",
    requiredCommit: "1f118b0b50ddcfc8d38b5e91319b21ce07be8584",
  },
  seedFix: {
    status: "not-needed",
    note: "The windfall came from runtime procurement contracts. The world seed creates none.",
  },
  envs: ["prod"],
  idempotent: true,
  guards: ["turn-lock-free", "money-conserving", "max-affected:1"],
  detect,
  plan,
  apply,
  verify,
};
