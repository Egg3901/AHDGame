import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

/**
 * Whether player line-of-credit is enabled (admin toggle on gameConfig).
 * Defaults to **enabled** — absent or `undefined` means on; only an explicit
 * `false` disables LOC. Pass a preloaded config from the same request to
 * avoid an extra read.
 */
export async function isLineOfCreditEnabled(
  preloadedConfig?: Pick<GameConfig, "lineOfCreditEnabled"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) {
    return preloadedConfig?.lineOfCreditEnabled !== false;
  }
  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { lineOfCreditEnabled: 1 } });
  return config?.lineOfCreditEnabled !== false;
}
