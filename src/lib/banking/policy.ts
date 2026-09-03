/**
 * Shell for the banking policy snapshot: one config read, one resolution.
 *
 * Turn phases call this once per turn and API routes once per request, then
 * pass the snapshot down instead of letting every helper re-read the flags.
 */

import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import {
  BANKING_POLICY_PROJECTION,
  resolveBankingPolicy,
  type BankingPolicyConfig,
  type BankingPolicySnapshot,
} from "@/lib/banking/rules/policy";

export type { BankingPolicySnapshot } from "@/lib/banking/rules/policy";

export async function loadBankingPolicy(db: Db): Promise<BankingPolicySnapshot> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { ...BANKING_POLICY_PROJECTION } });
  return resolveBankingPolicy(config as BankingPolicyConfig | null);
}
