import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import { retailCapacityExpansionPaused } from "@/lib/market/retailDemandTransition";
import { BANKING_POLICY_PROJECTION, resolveBankingPolicy } from "@/lib/banking/rules/policy";

export async function loadNppBehaviorConfig(db: Db, turn: number) {
  const config = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        labourSystemMode: 1,
        groupSupplyCoordinationEnabled: 1,
        marketSystemMode: 1,
        ledgerShadow: 1,
        retailDemandTransitionStartTurn: 1,
        retailDemandTransitionTurns: 1,
        ...BANKING_POLICY_PROJECTION,
      },
    }
  );
  return {
    labourMode: config?.labourSystemMode,
    groupManagementEnabled:
      config?.groupSupplyCoordinationEnabled === true && config?.marketSystemMode === "plants",
    ledgerShadow: config?.ledgerShadow === true,
    retailExpansionPaused: retailCapacityExpansionPaused(config, turn),
    bankingPolicy: resolveBankingPolicy(config),
  };
}
