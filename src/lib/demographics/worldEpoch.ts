/**
 * Population receipts belong to one world, even when reset repeats the calendar.
 * ensureDemographicWorldEpoch initializes missing legacy identity once; resets
 * replace it so an old population projection cannot qualify for the new world.
 */
import { ObjectId, type Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";

export async function ensureDemographicWorldEpoch(
  db: Db,
  known?: Pick<GameState, "worldEpochId">
): Promise<string> {
  if (known?.worldEpochId) return known.worldEpochId;
  const states = db.collection<GameState>("gameState");
  const current = await states.findOne({ _id: "current" }, { projection: { worldEpochId: 1 } });
  if (!current) throw new Error("Population receipts require an initialized world");
  if (current.worldEpochId) return current.worldEpochId;
  const initialized = await states.findOneAndUpdate(
    { _id: "current", worldEpochId: { $exists: false } },
    { $set: { worldEpochId: new ObjectId().toHexString() } },
    { returnDocument: "after", projection: { worldEpochId: 1 } }
  );
  const winner =
    initialized ?? (await states.findOne({ _id: "current" }, { projection: { worldEpochId: 1 } }));
  if (!winner?.worldEpochId)
    throw new Error("Could not establish population receipt world identity");
  return winner.worldEpochId;
}
