import type { Db, IndexSpecification } from "mongodb";
import { ensureIndex } from "./helpers";

// Equality/range prefixes used by turn queries. Keep these in bootstrap and
// the existing-world installer so a reset cannot reintroduce collection scans.
export const TURN_HOT_PATH_INDEXES: ReadonlyArray<{
  collection: string;
  key: IndexSpecification;
  name: string;
}> = [
  { collection: "corporationHistory", key: { turn: 1 }, name: "corporationHistory_turn" },
  { collection: "portfolioHistory", key: { characterId: 1 }, name: "portfolioHistory_characterId" },
  { collection: "bondHistory", key: { bondId: 1 }, name: "bondHistory_bondId" },
  { collection: "shareOrders", key: { status: 1 }, name: "shareOrders_status" },
];

export async function seedTurnHotPathIndexes(db: Db, log: (msg: string) => void) {
  for (const { collection, key, name } of TURN_HOT_PATH_INDEXES) {
    await ensureIndex(db, collection, key, { name }, log);
  }
}
