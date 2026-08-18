import { ObjectId, type Db } from "mongodb";
import type { Corporation, FederalBudget } from "@/lib/db/types";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import { DEFENCE_CONTRACT_SUPPLIER_SHARE } from "@/lib/military/defenceContractLimits";
import {
  defenceContractLotCaps,
  defenceContractWindow,
} from "@/lib/military/defenceContractLimits";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import { applyMoneyMove } from "@/lib/banking/moneyMove";
import type { Defect, DetectResult, HealPlan, HealResult, VerifyResult } from "../types";

interface Clawback {
  contractId: string;
  corporationId: string;
  countryId: string;
  excessLots: number;
  amount: number;
}

interface PlannedClawback extends Clawback {
  recoverableAmount: number;
  unrecoveredAmount: number;
}

interface Survey {
  clawbacks: PlannedClawback[];
  corporationIds: string[];
  budgetIds: string[];
  totalAmount: number;
  recoverableAmount: number;
  unrecoveredAmount: number;
  missing: string[];
}

interface ContractCandidate extends DefenceContract {
  netDelivered: number;
}

function orderContracts(a: DefenceContract, b: DefenceContract): number {
  return a.awardedTurn - b.awardedTurn || a._id.toString().localeCompare(b._id.toString());
}

export function findProcurementClawbacks(
  contracts: DefenceContract[],
  defenseLineByCountry: ReadonlyMap<string, number>
): Clawback[] {
  const candidates: ContractCandidate[] = contracts
    .filter((contract) => contract.lotsDelivered > 0 && contract.pricePerLot > 0)
    .map((contract) => ({
      ...contract,
      netDelivered: Math.max(
        0,
        contract.lotsDelivered - (contract.administrativeClawbackLots ?? 0)
      ),
    }))
    .filter((contract) => contract.netDelivered > 0)
    .sort(orderContracts);

  const countryUsed = new Map<string, number>();
  const supplierUsed = new Map<string, number>();
  const clawbacks: Clawback[] = [];

  for (const contract of candidates) {
    const window = defenceContractWindow(contract.countryId, contract.awardedTurn);
    const countryKey = window.id;
    const supplierKey = `${window.id}:${contract.corporationId.toString()}`;
    const caps = defenceContractLotCaps(
      defenseLineByCountry.get(contract.countryId) ?? 0,
      contract.pricePerLot
    );
    const countryRemaining = Math.max(
      0,
      caps.procurementNotional - (countryUsed.get(countryKey) ?? 0)
    );
    const supplierRemaining = Math.max(
      0,
      caps.procurementNotional * DEFENCE_CONTRACT_SUPPLIER_SHARE -
        (supplierUsed.get(supplierKey) ?? 0)
    );
    const recognizedLots = Math.min(
      contract.netDelivered,
      Math.floor(Math.min(countryRemaining, supplierRemaining) / contract.pricePerLot)
    );
    const recognizedAmount = recognizedLots * contract.pricePerLot;
    countryUsed.set(countryKey, (countryUsed.get(countryKey) ?? 0) + recognizedAmount);
    supplierUsed.set(supplierKey, (supplierUsed.get(supplierKey) ?? 0) + recognizedAmount);

    const excessLots = contract.netDelivered - recognizedLots;
    if (excessLots <= 0) continue;
    clawbacks.push({
      contractId: contract._id.toString(),
      corporationId: contract.corporationId.toString(),
      countryId: contract.countryId,
      excessLots,
      amount: excessLots * contract.pricePerLot,
    });
  }

  return clawbacks;
}

async function survey(db: Db): Promise<Survey> {
  const [contracts, budgets] = await Promise.all([
    db
      .collection<DefenceContract>("defenceContracts")
      .find({ lotsDelivered: { $gt: 0 } })
      .toArray(),
    db.collection<FederalBudget>("federalBudget").find({}).toArray(),
  ]);
  const budgetByCountry = new Map(budgets.map((budget) => [budget.countryId, budget]));
  const defenseLineByCountry = new Map(
    budgets.map((budget) => [budget.countryId, resolveDefenseLineFrom(budget)])
  );
  const rawClawbacks = findProcurementClawbacks(contracts, defenseLineByCountry);
  const corporationIds = [...new Set(rawClawbacks.map((row) => row.corporationId))];
  const countries = [...new Set(rawClawbacks.map((row) => row.countryId))];
  const corporations =
    corporationIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corporationIds.map((id) => new ObjectId(id)) } })
          .toArray()
      : [];
  const corporationIdSet = new Set(corporations.map((corp) => corp._id.toString()));
  const cashRemaining = new Map(
    corporations.map((corp) => [corp._id.toString(), Math.max(0, corp.liquidCapital)])
  );
  const clawbacks: PlannedClawback[] = rawClawbacks.map((row) => {
    const available = cashRemaining.get(row.corporationId) ?? 0;
    const recoverableAmount = Math.min(row.amount, available);
    cashRemaining.set(row.corporationId, available - recoverableAmount);
    return {
      ...row,
      recoverableAmount,
      unrecoveredAmount: row.amount - recoverableAmount,
    };
  });
  const missing = [
    ...corporationIds
      .filter((id) => !corporationIdSet.has(id))
      .map((id) => `corporation ${id} is missing`),
    ...countries
      .filter((countryId) => !budgetByCountry.has(countryId))
      .map((countryId) => `federal budget for ${countryId} is missing`),
  ];
  const budgetIds = countries.flatMap((countryId) => {
    const budget = budgetByCountry.get(countryId);
    return budget ? [String(budget._id)] : [];
  });
  return {
    clawbacks,
    corporationIds,
    budgetIds,
    totalAmount: clawbacks.reduce((sum, row) => sum + row.amount, 0),
    recoverableAmount: clawbacks.reduce((sum, row) => sum + row.recoverableAmount, 0),
    unrecoveredAmount: clawbacks.reduce((sum, row) => sum + row.unrecoveredAmount, 0),
    missing,
  };
}

async function detect(db: Db): Promise<DetectResult> {
  const result = await survey(db);
  return {
    affected: result.clawbacks.length,
    sample: result.clawbacks.slice(0, 10),
    notes: [
      `${result.clawbacks.length} contract(s) contain delivered lots beyond the budget and supplier limits`,
      `${result.totalAmount.toLocaleString("en-US")} local-currency units require recovery`,
      `${result.recoverableAmount.toLocaleString("en-US")} remains collectible from suppliers`,
      ...result.missing,
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const result = await survey(db);
  if (result.missing.length > 0) {
    throw new Error(`cannot plan procurement clawback: ${result.missing.join("; ")}`);
  }
  return {
    affected: result.clawbacks.length,
    touched: [
      { collection: "defenceContracts", ids: result.clawbacks.map((row) => row.contractId) },
      { collection: "corporations", ids: result.corporationIds },
      { collection: "federalBudget", ids: result.budgetIds },
    ],
    moneyDelta: 0,
    summary:
      `recover ${result.recoverableAmount.toLocaleString("en-US")} from ` +
      `${result.clawbacks.length} over-awarded defence contract(s) and return it to appropriations`,
    notes: [
      "Delivered materiel remains government property; this reverses only the invalid supplier payment.",
      `${result.unrecoveredAmount.toLocaleString("en-US")} is no longer held by the supplier and is recorded as unrecovered rather than minted back into the appropriation.`,
      "Every changed document is snapshotted by the remediation runner before the first write.",
    ],
    payload: result,
  };
}

/**
 * Idempotency key for recovering one contract's over-award inside one heal run.
 *
 * Per contract rather than per corporation, because a contract is the unit the survey plans
 * and the unit the stamp records, so the money and the paper trail cannot drift apart. Scoped
 * to the run so a genuinely NEW over-award found later is recovered again, while a retry of
 * the same run replays and moves nothing.
 */
export function procurementClawbackMoveKey(runId: string, contractId: string): string {
  return `defence-clawback:${runId}:${contractId}`;
}

async function apply(
  db: Db,
  healPlan: HealPlan,
  ctx: { now: Date; runId?: string }
): Promise<HealResult> {
  const result = healPlan.payload as Survey;
  const runId = ctx.runId;
  if (!runId) {
    // Without a run id there is no stable key, and unkeyed money movement is exactly what a
    // retried heal must never do. Refusing costs nothing: the runner always supplies one.
    throw new Error("procurement clawback needs a run id to key its money moves");
  }

  // One keyed, net-zero move per contract, replacing two bare guarded `$inc`s that were
  // ordered corporations-then-budgets with nothing joining them. A throw between the two used
  // to destroy the recovered money outright, and a re-run debited the supplier a second time
  // because nothing recorded that the first had happened.
  let moved = 0;
  for (const row of result.clawbacks) {
    if (!(row.recoverableAmount > 0)) continue;
    const outcome = await applyMoneyMove(db, {
      key: procurementClawbackMoveKey(runId, row.contractId),
      kind: "defence-clawback",
      legs: [
        {
          kind: "debit",
          amount: row.recoverableAmount,
          collection: "corporations",
          filter: { _id: new ObjectId(row.corporationId) },
          path: "liquidCapital",
          note: `supplier ${row.corporationId} returns an over-awarded defence payment`,
        },
        {
          kind: "credit",
          amount: row.recoverableAmount,
          collection: "federalBudget",
          filter: { countryId: row.countryId, "defenseAppropriation.balance": { $type: "number" } },
          path: "defenseAppropriation.balance",
          note: `defence appropriation for ${row.countryId} receives the recovery`,
        },
      ],
    });
    if (outcome.status === "applied") moved += 1;
    if (outcome.status === "partial" || outcome.status === "rejected") {
      // Stop on the first hole rather than plough on. A partial move is already in the shared
      // repair queue with the legs that landed, so an operator can see precisely what is owed.
      throw new Error(
        `clawback for contract ${row.contractId} did not settle: ${outcome.error ?? outcome.status}`
      );
    }
  }

  for (const row of result.clawbacks) {
    const update = await db.collection<DefenceContract>("defenceContracts").updateOne(
      // Same run stamps a contract once. The money above already replays under its key, and
      // the stamp has to replay with it or a retry would double the recorded lots.
      { _id: new ObjectId(row.contractId), administrativeClawbackRunId: { $ne: runId } },
      {
        $inc: {
          administrativeClawbackLots: row.excessLots,
          administrativeClawbackAmount: row.recoverableAmount,
          administrativeClawbackUnrecoveredAmount: row.unrecoveredAmount,
        },
        $set: {
          administrativeClawbackAt: ctx.now,
          administrativeClawbackRunId: runId,
          updatedAt: ctx.now,
        },
      }
    );
    if (update.modifiedCount !== 1) {
      const already = await db
        .collection<DefenceContract>("defenceContracts")
        .findOne({ _id: new ObjectId(row.contractId), administrativeClawbackRunId: runId });
      if (!already) {
        throw new Error(`contract ${row.contractId} could not be marked as clawed back`);
      }
    }
  }

  return {
    documentsScanned: healPlan.affected,
    documentsUpdated: result.clawbacks.length + moved,
    notes: [
      `recovered ${result.recoverableAmount.toLocaleString("en-US")} without changing total money`,
      `recorded ${result.unrecoveredAmount.toLocaleString("en-US")} as uncollectible from the supplier`,
      `marked ${result.clawbacks.length} contract(s) with the recovery run`,
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const result = await survey(db);
  return {
    ok: result.clawbacks.length === 0 && result.missing.length === 0,
    remaining: result.clawbacks.length,
    notes:
      result.clawbacks.length === 0
        ? ["all delivered defence procurement is within the recognized budget and supplier limits"]
        : [
            `${result.clawbacks.length} contract(s) still contain uncorrected over-awards`,
            ...result.missing,
          ],
  };
}

export const defect: Defect = {
  id: "AHD-defence-procurement-overaward",
  title: "Defence contracts could obligate an unlimited future appropriation",
  severity: "P1",
  codeFix: { mergedTo: "main" },
  seedFix: {
    status: "not-needed",
    note: "contracts are created only by runtime player actions; the world seed creates no defence contracts",
  },
  envs: ["dev", "sandbox", "prod"],
  idempotent: true,
  guards: ["turn-lock-free", "max-affected:500", "money-conserving"],
  detect,
  plan,
  apply,
  verify,
};
