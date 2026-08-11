// Bulk-inserts one `turn_summary` ActivityLog per active character at the end of Group 6.
// Reads from `actionLogs` (written by /api/actions/execute during the previous turn window)
// and enriches each entry with target state names before bulk-inserting to `activityLog`.
// Wrapped in runPhase — errors log to Sentry but do not halt turn processing.

import { ObjectId, type Db } from "mongodb";
import type { ActionLog, Character, GameConfig } from "@/lib/db/types";
import type { ActivityAction, ActivityLogTurnSummary } from "@/lib/db/types/activityLog";

export interface ActivityLoggingResult {
  summariesInserted: number;
}

/**
 * @param db - Already-connected Db instance from the turn processor
 * @param newTurn - The turn number being processed (actions were logged with turn === newTurn - 1)
 * @param config - GameConfig for reading baseActionsPerTurn (used to approximate apTotal)
 */
export async function processActivityLogging(
  db: Db,
  newTurn: number,
  config: GameConfig | null
): Promise<ActivityLoggingResult> {
  // Actions are logged with gameState.currentTurn at the time they execute,
  // which is newTurn - 1 (the turn before the one being processed now).
  const actionTurn = newTurn - 1;

  const logs = await db.collection<ActionLog>("actionLogs").find({ turn: actionTurn }).toArray();

  if (logs.length === 0) return { summariesInserted: 0 };

  // Filter out rest actions — no signal for abuse detection
  const activeLogs = logs.filter((l) => l.actionType !== "rest");
  if (activeLogs.length === 0) return { summariesInserted: 0 };

  // Group by characterId
  const byCharacter = new Map<string, ActionLog[]>();
  for (const log of activeLogs) {
    const key = log.characterId.toString();
    const arr = byCharacter.get(key) ?? [];
    arr.push(log);
    byCharacter.set(key, arr);
  }

  // Batch-fetch characters for name, userId, countryId, and current actions (post-refresh)
  const characterIds = [...byCharacter.keys()].map((id) => new ObjectId(id));
  const characters = await db
    .collection<Character>("characters")
    .find(
      { _id: { $in: characterIds } },
      { projection: { _id: 1, name: 1, userId: 1, countryId: 1, actions: 1 } }
    )
    .toArray();
  const charMap = new Map(characters.map((c) => [c._id.toString(), c]));

  // Batch-fetch usernames
  const userIds = characters.map((c) => c.userId);
  const users = await db
    .collection("users")
    .find({ _id: { $in: userIds } }, { projection: { _id: 1, username: 1 } })
    .toArray();
  const userMap = new Map(users.map((u) => [u._id.toString(), u.username as string]));

  // Batch-fetch state names for target enrichment
  const targetStateIds = [
    ...new Set(activeLogs.filter((l) => l.targetState).map((l) => l.targetState!)),
  ];
  const stateNameMap = new Map<string, string>();
  if (targetStateIds.length > 0) {
    // State _id values are strings (e.g. "CA", "TX"), not ObjectIds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const states = (await (db.collection("states") as any)
      .find({ _id: { $in: targetStateIds } }, { projection: { _id: 1, name: 1 } })
      .toArray()) as Array<{ _id: string; name: string }>;
    for (const s of states) {
      stateNameMap.set(s._id, s.name);
    }
  }

  const baseAp = config?.baseActionsPerTurn ?? 4;
  const now = new Date();
  const summaries: ActivityLogTurnSummary[] = [];

  for (const [charIdStr, charLogs] of byCharacter) {
    const char = charMap.get(charIdStr);
    if (!char) continue;

    const username = userMap.get(char.userId.toString()) ?? "unknown";
    const apSpent = charLogs.reduce((sum, l) => sum + l.actionCost, 0);

    // char.actions is the post-refresh value for the new turn, which is the same
    // formula as the previous turn — a good-enough approximation of the turn's AP quota.
    const apTotal = char.actions > 0 ? char.actions : baseAp;

    const actions: ActivityAction[] = charLogs.map((l) => {
      const stateName = l.targetState ? stateNameMap.get(l.targetState) : undefined;
      return {
        // ActionType is a strict subset of ActivityAction["type"]
        type: l.actionType as ActivityAction["type"],
        apCost: l.actionCost,
        targetName: stateName,
        targetType: l.targetState ? ("state" as const) : ("self" as const),
        result: {
          fundsChange: l.result.fundsChange,
          influenceChange: l.result.politicalInfluenceChange,
          favorabilityChange: l.result.favorabilityChange,
          infamyChange: l.result.infamyChange,
        },
      };
    });

    summaries.push({
      _id: new ObjectId(),
      type: "turn_summary",
      timestamp: now,
      userId: char.userId,
      characterId: char._id,
      characterName: char.name,
      username,
      countryId: char.countryId,
      turnNumber: actionTurn,
      apSpent,
      apTotal,
      actions,
    });
  }

  if (summaries.length === 0) return { summariesInserted: 0 };

  await db.collection("activityLog").insertMany(summaries);
  return { summariesInserted: summaries.length };
}
