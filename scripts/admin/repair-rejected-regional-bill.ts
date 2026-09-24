import { ObjectId } from "mongodb";
import { getDb, getMongoClient } from "../../src/lib/mongodb";
import { repairRejectedRegionalBill } from "../../src/lib/budget/repairRejectedRegionalBill";
import type { GameState } from "../../src/lib/db/types/gameState";

const [billIdText, rejectedAtText, action] = process.argv.slice(2);
if (!ObjectId.isValid(billIdText ?? "") || !rejectedAtText || (action && action !== "--apply")) {
  throw new Error(
    "Usage: tsx scripts/admin/repair-rejected-regional-bill.ts <billId> <rejectedAt ISO> [--apply]"
  );
}
const rejectedAt = new Date(rejectedAtText);
if (Number.isNaN(rejectedAt.getTime())) throw new Error("Invalid rejection timestamp");

try {
  const db = await getDb();
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  if (typeof gameState?.currentTurn !== "number") throw new Error("Current turn is missing");
  const result = await repairRejectedRegionalBill(
    db,
    new ObjectId(billIdText),
    rejectedAt,
    gameState.currentTurn,
    action === "--apply"
  );
  console.log(JSON.stringify(result));
} finally {
  await (await getMongoClient()).close();
}
