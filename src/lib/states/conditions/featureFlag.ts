import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

export const REGIONAL_CONDITIONS_DISABLED_MESSAGE =
  "Regional conditions on the state overview are not enabled yet.";

/**
 * Whether the state overview tab surfaces active approval modifiers
 * (Economic Boom, Population Decline, etc.) in a dedicated card.
 *
 * Defaults to off — admins enable via the dashboard feature panel.
 */
export async function isRegionalConditionsOverviewEnabled(
  preloadedConfig?: Pick<GameConfig, "regionalConditionsOverviewEnabled"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) {
    return preloadedConfig?.regionalConditionsOverviewEnabled === true;
  }
  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { regionalConditionsOverviewEnabled: 1 } });
  return config?.regionalConditionsOverviewEnabled === true;
}
