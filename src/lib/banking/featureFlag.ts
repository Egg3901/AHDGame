import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

type BankingFlags = Pick<
  GameConfig,
  "privateBankingEnabled" | "bankPropTradingEnabled" | "bankContagionEnabled"
>;

/**
 * Whether private banking is enabled (admin toggle on gameConfig).
 * Defaults to **disabled** - only an explicit `true` enables. Flag-off is a
 * read-only freeze, not a drain. Pass a preloaded config from the same
 * request to avoid an extra read.
 */
export async function isPrivateBankingEnabled(
  preloadedConfig?: BankingFlags | null
): Promise<boolean> {
  const config = await loadFlags(preloadedConfig);
  return config?.privateBankingEnabled === true;
}

/** Kill switch: prop trading. Requires banking on; absent means on. */
export async function isBankPropTradingEnabled(
  preloadedConfig?: BankingFlags | null
): Promise<boolean> {
  const config = await loadFlags(preloadedConfig);
  return config?.privateBankingEnabled === true && config?.bankPropTradingEnabled !== false;
}

/** Kill switch: failure contagion. Requires banking on; absent means on. */
export async function isBankContagionEnabled(
  preloadedConfig?: BankingFlags | null
): Promise<boolean> {
  const config = await loadFlags(preloadedConfig);
  return config?.privateBankingEnabled === true && config?.bankContagionEnabled !== false;
}

async function loadFlags(preloadedConfig?: BankingFlags | null): Promise<BankingFlags | null> {
  if (preloadedConfig !== undefined) {
    return preloadedConfig;
  }
  const db = await getDb();
  return db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        privateBankingEnabled: 1,
        bankPropTradingEnabled: 1,
        bankContagionEnabled: 1,
      },
    }
  );
}
