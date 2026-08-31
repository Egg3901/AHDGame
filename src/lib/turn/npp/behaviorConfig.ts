import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import { retailCapacityExpansionPaused } from "@/lib/market/retailDemandTransition";

export async function loadNppBehaviorConfig(db: Db, turn: number) {
  const config = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        labourSystemMode: 1,
        retailDemandTransitionStartTurn: 1,
        retailDemandTransitionTurns: 1,
      },
    }
  );
  return {
    labourMode: config?.labourSystemMode,
    retailExpansionPaused: retailCapacityExpansionPaused(config, turn),
  };
}
