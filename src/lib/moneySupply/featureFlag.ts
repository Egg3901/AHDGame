import type { GameConfig } from "@/lib/db/types";

export function isMoneySupplyEnabledFromConfig(
  config?: Pick<GameConfig, "moneySupplyEnabled"> | null
): boolean {
  return config?.moneySupplyEnabled === true;
}
