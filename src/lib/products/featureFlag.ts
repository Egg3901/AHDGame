import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types/gameConfig";

export function resolveCorporationProductsEnabled(
  config: Pick<GameConfig, "corporationProductsEnabled"> | null | undefined
): boolean {
  return config?.corporationProductsEnabled === true;
}

/**
 * Product Studio launch gate. Absent or false keeps every existing sector,
 * turn, and market path unchanged; routes render a disabled state and refuse
 * mutations.
 */
export async function isCorporationProductsEnabled(db: Db): Promise<boolean> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { corporationProductsEnabled: 1 } });
  return resolveCorporationProductsEnabled(config);
}
