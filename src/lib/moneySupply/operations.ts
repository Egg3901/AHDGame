import { ObjectId, type Db } from "mongodb";
import type { CentralBank, MonetaryOperationRecord, MonetaryOperationType } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import { executeLiquidityAdvance } from "./liquidityAdvance";
import { executeJournaledMonetaryOperation } from "./monetaryOperationJournal";

export const MONETARY_OPERATION_COOLDOWN_TURNS = 6;
export const DIRECT_ADVANCE_GDP_CAP = 0.01;
export const LIQUIDITY_INJECTION_GDP_CAP = 0.03;

export interface ExecuteMonetaryOperationInput {
  countryId: CountryId;
  operationId?: string;
  bypassCooldown?: boolean;
  type: MonetaryOperationType;
  turn: number;
  actorName: string;
  reason?: string;
  amount?: number;
  bondId?: string;
  units?: number;
}

export async function executeMonetaryOperation(
  db: Db,
  input: ExecuteMonetaryOperationInput
): Promise<MonetaryOperationRecord> {
  const bankId = getBankId(input.countryId);
  const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
  if (!bank) throw new Error("Central bank not found");
  if (input.type !== "liquidity_injection") {
    return executeJournaledMonetaryOperation(
      db,
      {
        ...input,
        operationId: input.operationId ?? new ObjectId().toHexString(),
        type: input.type,
      },
      MONETARY_OPERATION_COOLDOWN_TURNS
    );
  }
  const amount = Math.max(0, Math.floor(input.amount ?? 0));
  if (amount <= 0) throw new Error("Amount must be positive");
  return executeLiquidityAdvance(
    db,
    {
      operationId: input.operationId ?? new ObjectId().toHexString(),
      countryId: input.countryId,
      amount,
      turn: input.turn,
      actorName: input.actorName,
      reason: input.reason,
      bypassCooldown: input.bypassCooldown,
    },
    MONETARY_OPERATION_COOLDOWN_TURNS
  );
}
