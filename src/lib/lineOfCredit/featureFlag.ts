import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import { resolveBankingPolicy } from "@/lib/banking/rules/policy";

/**
 * Whether player line-of-credit is enabled (admin toggle on gameConfig).
 * Defaults to **enabled**: absent or `undefined` means on; only an explicit
 * `false` disables LOC. The interpretation lives in the banking policy
 * snapshot (`banking/rules/policy.ts`) alongside the other switches, so a
 * default cannot drift between this reader and the turn. Pass a preloaded
 * config from the same request to avoid an extra read.
 */
export async function isLineOfCreditEnabled(
  preloadedConfig?: Pick<GameConfig, "lineOfCreditEnabled"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) {
    return resolveBankingPolicy(preloadedConfig).lineOfCredit;
  }
  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { lineOfCreditEnabled: 1 } });
  return resolveBankingPolicy(config).lineOfCredit;
}
