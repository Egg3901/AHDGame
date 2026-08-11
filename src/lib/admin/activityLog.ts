import { ObjectId, type Db } from "mongodb";
import type { ActionLog } from "@/lib/db/types/gameState";
import type { ActivityLog, ActivityLogGameAction } from "@/lib/db/types/activityLog";
import type { CountryId } from "@/lib/constants/countries";

export interface IdentityLookup {
  characterName?: string;
  countryId?: CountryId | string;
}

/** Pure: map a raw actionLogs row into a `game_action` activity event. */
export function mapActionLogToEvent(
  row: ActionLog,
  lookup: Map<string, IdentityLookup>
): ActivityLogGameAction {
  const fallback = lookup.get(row.characterId.toHexString());
  return {
    _id: row._id,
    type: "game_action",
    timestamp: row.createdAt,
    userId: row.userId,
    characterId: row.characterId,
    characterName: row.characterName ?? fallback?.characterName,
    username: row.username,
    countryId: (row.countryId ?? (fallback?.countryId as CountryId | undefined)) as
      CountryId | undefined,
    actionType: row.actionType,
    actionCost: row.actionCost,
    turn: row.turn,
    result: {
      success: row.result.success,
      fundsChange: row.result.fundsChange,
      politicalInfluenceChange: row.result.politicalInfluenceChange,
      message: row.result.message,
    },
    summary: `${row.actionType} (turn ${row.turn}) — ${row.result.message}`,
  };
}

export interface MergedActivityPage {
  events: ActivityLog[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Pure: merge two `_id`-desc-sorted streams (activityLog rows + mapped
 * game_action events) into one `_id`-desc page of `limit`, computing hasMore /
 * nextCursor. ObjectIds are globally time-ordered, so a single `_id` cursor
 * works across both collections.
 */
export function mergeActivityPage(
  activityRows: ActivityLog[],
  gameEvents: ActivityLog[],
  limit: number
): MergedActivityPage {
  const combined = [...activityRows, ...gameEvents].sort((a, b) =>
    (b._id as ObjectId).toHexString().localeCompare((a._id as ObjectId).toHexString())
  );
  const hasMore = combined.length > limit;
  const events = hasMore ? combined.slice(0, limit) : combined;
  const nextCursor =
    hasMore && events.length > 0 ? (events[events.length - 1]._id as ObjectId).toHexString() : null;
  return { events, nextCursor, hasMore };
}

export interface FetchActivityParams {
  type?: string;
  userId?: ObjectId;
  characterId?: ObjectId;
  countryId?: string;
  from?: Date;
  to?: Date;
  search?: string;
  flagSeverities?: string[];
  cursor: string | null;
  limit: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildActionLogSearchFilter(
  search: string,
  matchedUserIds: ObjectId[],
  matchedCharacterIds: ObjectId[]
): Record<string, unknown> {
  const regex = new RegExp(escapeRegex(search.trim()), "i");
  const orClauses: Record<string, unknown>[] = [{ username: regex }, { characterName: regex }];
  if (matchedUserIds.length > 0) {
    orClauses.push({ userId: { $in: matchedUserIds } });
  }
  if (matchedCharacterIds.length > 0) {
    orClauses.push({ characterId: { $in: matchedCharacterIds } });
  }
  return { $or: orClauses };
}

/**
 * Reads activityLog and (unless excluded by filters) actionLogs, maps the latter
 * to game_action events, and merges into one _id-desc page. actionLogs is
 * excluded only when a non-game_action `type` filter is set.
 */
export async function fetchActivityLog(
  db: Db,
  params: FetchActivityParams
): Promise<MergedActivityPage> {
  const idCursor = params.cursor ? { $lt: new ObjectId(params.cursor) } : undefined;

  // Flag-severity filter: restrict to users/characters carrying suspicion flags
  // whose highestSeverity is among the selected set. Empty selection ⇒ no
  // restriction (all entries).
  let idRestriction: Record<string, unknown> | undefined;
  if (params.flagSeverities && params.flagSeverities.length > 0) {
    const flagged = await db
      .collection("suspiciousCharacters")
      .find(
        { highestSeverity: { $in: params.flagSeverities } },
        { projection: { characterId: 1, userId: 1 } }
      )
      .toArray();
    const charIds = flagged.map((f) => f.characterId as ObjectId);
    const userIds = flagged.map((f) => f.userId as ObjectId);
    idRestriction = {
      $or: [{ characterId: { $in: charIds } }, { userId: { $in: userIds } }],
    };
  }

  const wantActivity = !params.type || params.type !== "game_action";
  const wantActions = !params.type || params.type === "game_action";

  // ── activityLog query ──
  let activityRows: ActivityLog[] = [];
  if (wantActivity) {
    const filter: Record<string, unknown> = {};
    if (params.type && params.type !== "game_action") filter.type = params.type;
    if (params.userId) filter.userId = params.userId;
    if (params.characterId) filter.characterId = params.characterId;
    if (params.countryId) filter.countryId = params.countryId;
    if (params.from || params.to) {
      filter.timestamp = {
        ...(params.from ? { $gte: params.from } : {}),
        ...(params.to ? { $lte: params.to } : {}),
      };
    }
    if (params.search?.trim()) filter.$text = { $search: params.search.trim() };
    if (idCursor) filter._id = idCursor;
    if (idRestriction) Object.assign(filter, idRestriction);
    activityRows = (await db
      .collection<ActivityLog>("activityLog")
      .find(filter)
      .sort({ _id: -1 })
      .limit(params.limit + 1)
      .toArray()) as ActivityLog[];
  }

  // ── actionLogs query → game_action ──
  let gameEvents: ActivityLog[] = [];
  if (wantActions) {
    const filter: Record<string, unknown> = {};
    if (params.userId) filter.userId = params.userId;
    if (params.characterId) filter.characterId = params.characterId;
    if (params.countryId) filter.countryId = params.countryId;
    if (params.from || params.to) {
      filter.createdAt = {
        ...(params.from ? { $gte: params.from } : {}),
        ...(params.to ? { $lte: params.to } : {}),
      };
    }
    if (idCursor) filter._id = idCursor;
    const andClauses: Record<string, unknown>[] = [];
    if (idRestriction) andClauses.push(idRestriction);
    if (params.search?.trim()) {
      const regex = new RegExp(escapeRegex(params.search.trim()), "i");
      const [matchedUsers, matchedCharacters] = await Promise.all([
        db
          .collection("users")
          .find({ username: regex }, { projection: { _id: 1 } })
          .limit(50)
          .toArray(),
        db
          .collection("characters")
          .find({ name: regex }, { projection: { _id: 1, userId: 1 } })
          .limit(50)
          .toArray(),
      ]);
      const matchedUserIds = [
        ...matchedUsers.map((user) => user._id as ObjectId),
        ...matchedCharacters
          .map((character) => character.userId as ObjectId | undefined)
          .filter((userId): userId is ObjectId => userId instanceof ObjectId),
      ];
      const dedupedUserIds = [
        ...new Map(matchedUserIds.map((id) => [id.toHexString(), id])).values(),
      ];
      const matchedCharacterIds = matchedCharacters.map((character) => character._id as ObjectId);
      andClauses.push(
        buildActionLogSearchFilter(params.search.trim(), dedupedUserIds, matchedCharacterIds)
      );
    }
    if (andClauses.length === 1) {
      Object.assign(filter, andClauses[0]);
    } else if (andClauses.length > 1) {
      filter.$and = andClauses;
    }
    const rows = (await db
      .collection<ActionLog>("actionLogs")
      .find(filter)
      .sort({ _id: -1 })
      .limit(params.limit + 1)
      .toArray()) as ActionLog[];

    // Backfill identity for rows lacking denormalized fields (pre-write-change).
    const needLookup = rows.filter((r) => !r.characterName).map((r) => r.characterId);
    const lookup = new Map<string, IdentityLookup>();
    if (needLookup.length > 0) {
      const chars = await db
        .collection("characters")
        .find({ _id: { $in: needLookup } }, { projection: { name: 1, countryId: 1 } })
        .toArray();
      for (const c of chars) {
        lookup.set((c._id as ObjectId).toHexString(), {
          characterName: c.name as string,
          countryId: c.countryId as string,
        });
      }
    }
    gameEvents = rows.map((r) => mapActionLogToEvent(r, lookup));
  }

  return mergeActivityPage(activityRows, gameEvents, params.limit);
}
