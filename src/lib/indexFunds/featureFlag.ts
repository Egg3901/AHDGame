import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

export const INDEX_FUNDS_DISABLED_MESSAGE = "Index funds are not enabled yet.";
export const INDEX_FUNDS_PARTIAL_MESSAGE =
  "Index funds are in partial mode — fund viewing is available, but subscriptions and redemptions are not enabled yet.";

export type IndexFundsMode = "off" | "partial" | "full";

/**
 * Resolve the current index-funds mode.
 * Pass a preloaded config from the same request to avoid an extra read.
 * Returns "off" for absent/unknown values.
 */
export async function getIndexFundsMode(
  preloadedConfig?: Pick<GameConfig, "indexFundsMode" | "indexFundsEnabled"> | null
): Promise<IndexFundsMode> {
  let mode: string | undefined;
  let legacyEnabled: boolean | undefined;
  if (preloadedConfig !== undefined) {
    mode = preloadedConfig?.indexFundsMode;
    legacyEnabled = preloadedConfig?.indexFundsEnabled;
  } else {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { indexFundsMode: 1, indexFundsEnabled: 1 } });
    mode = config?.indexFundsMode;
    legacyEnabled = config?.indexFundsEnabled;
  }
  if (mode === "partial" || mode === "full") return mode;
  if (legacyEnabled === true) return "full";
  return "off";
}

/**
 * Whether index-fund read-only features are available (partial or full mode).
 * Use this to gate fund listings, detail views, cron, and NPP investing.
 */
export async function isIndexFundsEnabled(
  preloadedConfig?: Pick<GameConfig, "indexFundsMode"> | null
): Promise<boolean> {
  const mode = await getIndexFundsMode(preloadedConfig);
  return mode === "partial" || mode === "full";
}

/**
 * Whether index-fund player transactions (subscribe/redeem) are allowed.
 * Only true in "full" mode.
 */
export async function isIndexFundsFullMode(
  preloadedConfig?: Pick<GameConfig, "indexFundsMode"> | null
): Promise<boolean> {
  const mode = await getIndexFundsMode(preloadedConfig);
  return mode === "full";
}
