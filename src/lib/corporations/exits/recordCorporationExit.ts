import type { Db, ObjectId } from "mongodb";
import type {
  CorporationExit,
  CorporationExitReason,
  CorporationHistory,
  User,
} from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { buildCorporationExit, type CorporationExitSnapshot } from "./rules";

/**
 * Write the exit row for a corporation that has just been deleted. Call it
 * right after the delete, with the pre-delete document. Idempotent per
 * corporation (`_id` is the corporation id, `$setOnInsert`), and by default
 * never throws: a missing exit row must not undo or block a settlement that
 * already committed.
 *
 * A resumable settlement passes `strict` and calls this BEFORE deleting the
 * corporation: the delete is the point of no return, so a failure here must
 * surface and retry while the document still exists to be snapshotted.
 */
export async function recordCorporationExit(
  db: Db,
  corporation: CorporationExitSnapshot,
  params: {
    reason: CorporationExitReason;
    successorId?: ObjectId;
    successorIds?: ObjectId[];
    now?: Date;
    turn?: number;
    strict?: boolean;
    /** Admin cleanup is not a player-attributable corporate end. */
    cooldownExempt?: boolean;
  }
): Promise<void> {
  try {
    const turn = params.turn ?? (await getCurrentTurn(db));
    const last = await db
      .collection<CorporationHistory>("corporationHistory")
      .find({ corporationId: corporation._id }, { projection: { revenue: 1 } })
      .sort({ turn: -1 })
      .limit(1)
      .next();
    const exit = buildCorporationExit({
      corporation,
      reason: params.reason,
      turn,
      lastRevenue: last?.revenue,
      successorId: params.successorId,
      successorIds: params.successorIds,
      now: params.now ?? new Date(),
    });
    const { _id, ...fields } = exit;
    await db
      .collection<CorporationExit>("corporationExits")
      .updateOne({ _id }, { $setOnInsert: fields }, { upsert: true });

    const userId = corporation.userId?.toString();
    if (
      userId &&
      userId !== "000000000000000000000000" &&
      !corporation.countryOwnerId &&
      corporation.ownershipState !== "stateOwned" &&
      !params.cooldownExempt
    ) {
      // `$max` makes retries safe and never moves the anchor backwards.
      await db
        .collection<User>("users")
        .updateOne({ _id: corporation.userId }, { $max: { lastCorporationFoundedTurn: turn } });
    }
  } catch (error) {
    if (params.strict) throw error;
    console.error(`[corporation-exit] failed to record exit of ${corporation._id}`, error);
  }
}
