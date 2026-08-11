import type { GameConfig } from "@/lib/db/types/gameConfig";

/**
 * Bretton Woods exit gate. Fail-safe: only an explicit `true` enables it, so a
 * world with no opinion keeps the pegged behaviour byte-identically.
 */
export function isBrettonWoodsExitEnabled(
  config?: Pick<GameConfig, "brettonWoodsExitEnabled"> | null
): boolean {
  return config?.brettonWoodsExitEnabled === true;
}
