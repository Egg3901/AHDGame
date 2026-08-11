import type { Db } from "mongodb";
import type { CharacterAchievement } from "@/lib/db/types/achievement";

export function getCharacterAchievementsCollection(db: Db) {
  return db.collection<CharacterAchievement>("characterAchievements");
}
