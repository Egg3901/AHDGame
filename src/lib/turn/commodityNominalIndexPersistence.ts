import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";

export async function persistCommodityNominalIndex(
  db: Db,
  index: number,
  turn: number
): Promise<void> {
  await db
    .collection<GameConfig>("gameConfig")
    .updateOne(
      { _id: "default" },
      { $set: { commodityNominalPriceIndex: index, commodityNominalPriceIndexTurn: turn } }
    );
}
