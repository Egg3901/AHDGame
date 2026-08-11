import type { Db } from "mongodb";
import type { Achievement, Character } from "@/lib/db/types";

export interface AchievementProgress {
  current: number;
  target: number;
}

export async function getAchievementProgress(
  db: Db,
  character: Pick<Character, "_id" | "userId" | "funds">,
  achievement: Achievement
): Promise<AchievementProgress | null> {
  try {
    const config = achievement.triggerConfig ?? {};
    switch (achievement.triggerType) {
      case "action_count": {
        const target = Number(config.count);
        if (!Number.isFinite(target)) return null;
        const actionType = config.actionType;
        const actionTypes = config.actionTypes;
        const filter: Record<string, unknown> = { characterId: character._id };
        if (typeof actionType === "string") filter.actionType = actionType;
        else if (Array.isArray(actionTypes)) filter.actionType = { $in: actionTypes };
        return {
          current: await db.collection("actionLogs").countDocuments(filter),
          target,
        };
      }
      case "election_won": {
        const target = Number(config.count);
        if (!Number.isFinite(target)) return null;
        return {
          current: await db
            .collection("electedOfficials")
            .countDocuments({ characterId: character._id }),
          target,
        };
      }
      case "influence_count": {
        const target = Number(config.count);
        return {
          current: await db.collection("actionLogs").countDocuments({
            characterId: character._id,
            actionType: { $in: ["supportPlayer", "attackPlayer", "barnstorm"] },
          }),
          target,
        };
      }
      case "subscriber_count": {
        const target = Number(config.count);
        return {
          current: await db
            .collection("userSubscriptions")
            .countDocuments({ subscribedToCharacterId: character._id }),
          target,
        };
      }
      case "funds_threshold":
        return { current: character.funds ?? 0, target: Number(config.amount) };
      case "news_reply":
        return {
          current: await db.collection("newsPosts").countDocuments({
            authorId: character._id,
            parentId: { $ne: null },
          }),
          target: Number(config.count ?? 5),
        };
      default:
        return null;
    }
  } catch (error) {
    console.error("[achievements] getAchievementProgress error:", error);
    return null;
  }
}
