import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

/**
 * Feature-flag resolvers for the resource-prospecting and extraction-contract
 * systems. Both default OFF (absent/undefined = off; only explicit `true`
 * enables). Modeled on src/lib/market/featureFlag.ts — pass a preloaded config
 * (turn phases already hold one) to avoid an extra gameConfig read.
 */

/**
 * Resource prospecting (geological surveys that expand state extraction
 * capacity). Gates the launch routes and the prospectingResolution turn phase.
 */
export async function isProspectingEnabled(
  preloadedConfig?: Pick<GameConfig, "prospectingEnabled"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) return preloadedConfig?.prospectingEnabled === true;
  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { prospectingEnabled: 1 } });
  return config?.prospectingEnabled === true;
}

/**
 * Player-facing extraction-contract issuance + per-turn royalty settlement.
 * Gates the offer/accept/decline routes and the contractSettlement turn phase.
 */
export async function isContractIssuanceEnabled(
  preloadedConfig?: Pick<GameConfig, "contractIssuanceEnabled"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) return preloadedConfig?.contractIssuanceEnabled === true;
  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { contractIssuanceEnabled: 1 } });
  return config?.contractIssuanceEnabled === true;
}
