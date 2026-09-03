import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import {
  BANKING_POLICY_PROJECTION,
  resolveBankingPolicy,
  type BankingPolicyConfig,
} from "@/lib/banking/rules/policy";

type BankingFlags = Pick<
  GameConfig,
  | "privateBankingEnabled"
  | "bankPropTradingEnabled"
  | "bankContagionEnabled"
  | "playerAdvancedBankChartersEnabled"
>;

/**
 * Per-flag readers kept for the call sites that ask one question. Every one of
 * them is the policy snapshot's answer (`rules/policy.ts`), so a route and a
 * turn phase reading the same config document cannot interpret it differently.
 * Prefer `loadBankingPolicy` when more than one question is asked.
 */

/**
 * Whether private banking is enabled (admin toggle on gameConfig).
 * Defaults to **disabled** - only an explicit `true` enables. Flag-off is a
 * read-only freeze, not a drain. Pass a preloaded config from the same
 * request to avoid an extra read.
 */
export async function isPrivateBankingEnabled(
  preloadedConfig?: BankingFlags | null
): Promise<boolean> {
  return resolveBankingPolicy(await loadFlags(preloadedConfig)).privateBanking;
}

/** Kill switch: prop trading. Requires banking on; absent means on. */
export async function isBankPropTradingEnabled(
  preloadedConfig?: BankingFlags | null
): Promise<boolean> {
  return resolveBankingPolicy(await loadFlags(preloadedConfig)).propTrading;
}

/** Kill switch: failure contagion. Requires banking on; absent means on. */
export async function isBankContagionEnabled(
  preloadedConfig?: BankingFlags | null
): Promise<boolean> {
  return resolveBankingPolicy(await loadFlags(preloadedConfig)).contagion;
}

async function loadFlags(
  preloadedConfig?: BankingFlags | null
): Promise<BankingPolicyConfig | null> {
  if (preloadedConfig !== undefined) {
    return preloadedConfig;
  }
  const db = await getDb();
  return db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { ...BANKING_POLICY_PROJECTION } });
}
