import { ObjectId, type Db } from "mongodb";
import type { Defect, DetectResult, HealPlan, HealResult, VerifyResult } from "../types";

export const DEFECT_ID = "AHD-1171-us-marine-lot-progress";
export const CONTRACT_ID = "6a888f0a7badf9bb53c3971f";
export const UNIT_ID = "6a779f35e464c15609bfdbd2";
export const RESTORED_PROTECTION = 2.75;

interface ContractEvidence {
  _id: ObjectId;
  countryId?: string;
  component?: string;
  lotsOrdered?: number;
  lotsDelivered?: number;
  amountPaid?: number;
  status?: string;
}

interface UnitEvidence {
  _id: ObjectId;
  countryId?: string;
  domain?: string;
  type?: string;
  equipment?: { firepower?: number; protection?: number; support?: number };
}

interface ArsenalEvidence {
  countryId?: string;
  stock?: { marine?: number };
}

interface Survey {
  contract: ContractEvidence | null;
  unit: UnitEvidence | null;
  arsenal: ArsenalEvidence | null;
  affected: boolean;
  contractProvesDelivery: boolean;
}

async function survey(db: Db): Promise<Survey> {
  const [contract, unit, arsenal] = await Promise.all([
    db.collection<ContractEvidence>("defenceContracts").findOne({ _id: new ObjectId(CONTRACT_ID) }),
    db.collection<UnitEvidence>("militaryUnits").findOne({ _id: new ObjectId(UNIT_ID) }),
    db.collection<ArsenalEvidence>("nationalArsenal").findOne({ countryId: "US" }),
  ]);
  const contractProvesDelivery =
    contract?.countryId === "US" &&
    contract.component === "marine" &&
    contract.status === "complete" &&
    contract.lotsOrdered === 1 &&
    contract.lotsDelivered === 1 &&
    contract.amountPaid === 151_500_000;
  const affected =
    contractProvesDelivery &&
    unit?.countryId === "US" &&
    unit.domain === "marine" &&
    unit.type === "Marine Division" &&
    unit.equipment?.firepower === 3 &&
    unit.equipment.protection === 2 &&
    unit.equipment.support === 3 &&
    (arsenal?.stock?.marine ?? 0) === 0;
  return { contract, unit, arsenal, affected, contractProvesDelivery };
}

async function detect(db: Db): Promise<DetectResult> {
  const state = await survey(db);
  return {
    affected: state.affected ? 1 : 0,
    sample: state.affected
      ? [
          {
            contractId: CONTRACT_ID,
            unitId: UNIT_ID,
            delivered: state.contract?.lotsDelivered,
            paid: state.contract?.amountPaid,
            marineStock: state.arsenal?.stock?.marine ?? 0,
            equipment: state.unit?.equipment,
          },
        ]
      : [],
    notes: [
      state.contractProvesDelivery
        ? "the pinned contract proves one paid marine lot was delivered"
        : "the pinned production contract no longer matches the audited delivery evidence",
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const state = await survey(db);
  return {
    affected: state.affected ? 1 : 0,
    touched: state.affected ? [{ collection: "militaryUnits", ids: [UNIT_ID] }] : [],
    moneyDelta: 0,
    summary: state.affected
      ? "restore the fractional protection progress from one paid US marine lot"
      : "the audited US marine lot no longer needs compensation",
    notes: state.affected
      ? ["Marine Division protection 2 -> 2.75; arsenal and financial records stay unchanged"]
      : [],
  };
}

async function apply(db: Db, healPlan: HealPlan): Promise<HealResult> {
  if (healPlan.affected === 0) return { documentsScanned: 0, documentsUpdated: 0 };
  const result = await db.collection<UnitEvidence>("militaryUnits").updateOne(
    {
      _id: new ObjectId(UNIT_ID),
      countryId: "US",
      domain: "marine",
      type: "Marine Division",
      "equipment.firepower": 3,
      "equipment.protection": 2,
      "equipment.support": 3,
    },
    { $set: { "equipment.protection": RESTORED_PROTECTION } }
  );
  return {
    documentsScanned: 1,
    documentsUpdated: result.modifiedCount,
    notes: [`restored ${result.modifiedCount} Marine Division row(s)`],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const state = await survey(db);
  const protection = state.unit?.equipment?.protection ?? 0;
  const ok = !state.affected && state.contractProvesDelivery && protection >= RESTORED_PROTECTION;
  return {
    ok,
    remaining: state.affected ? 1 : 0,
    notes: [
      `Marine Division protection=${protection}`,
      `pinned delivery evidence=${state.contractProvesDelivery ? "intact" : "missing"}`,
      `marine stock=${state.arsenal?.stock?.marine ?? 0}`,
    ],
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "Paid US marine lot was consumed without equipment progress",
  severity: "P1",
  codeFix: {
    issue: 1171,
    pr: 705,
    mergedTo: "development",
    requiredCommit: "ff0946bf8832ce1de276ef35f397fec62ec6731b",
  },
  seedFix: {
    status: "not-needed",
    files: ["src/lib/admin/seed/seedMilitaryUnits.ts"],
    note: "the seed does not consume arsenal lots; the loss occurred only in the runtime refit step",
  },
  envs: ["prod"],
  idempotent: true,
  guards: ["turn-lock-free", "money-conserving", "max-affected:1"],
  detect,
  plan,
  apply,
  verify,
};
