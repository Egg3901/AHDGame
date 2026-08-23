import type { Db } from "mongodb";
import type { VietnamEscalationState } from "@/lib/crises/vietnamEscalation";
import { getVietnamEscalation } from "@/lib/crises/vietnamEscalation";
import type { Crisis, CrisisInteraction } from "@/lib/db/types/crisis";
import { emptyConflictState } from "./engine";
import { loadConflictState, saveConflictState } from "./driver";

/** Import an already-running legacy ladder before the 1.3 driver touches it. */
export async function migrateLegacyVietnamState(db: Db): Promise<boolean> {
  const current = await loadConflictState(db, "vietnam");
  if (current.hasOpened) return false;
  const legacy = await getVietnamEscalation(db);
  if (!legacy.hasOpened || legacy.level <= 0) return false;
  await saveConflictState(db, {
    ...emptyConflictState("vietnam"),
    hasOpened: true,
    phaseLevel: legacy.level,
    intensity: Math.min(100, Math.round((legacy.level / 6) * 100)),
    openedYear: null,
    pressure: { a: legacy.westSupport, b: legacy.eastSupport },
    totalTurns: legacy.warTurns,
    emitPhaseEntryNextTurn: true,
    updatedAt: new Date(),
  });
  return true;
}

/** Present the 1.3 Vietnam state to unchanged Cold War dial and front callers. */
export async function livingVietnamAsLegacyState(db: Db): Promise<VietnamEscalationState> {
  const state = (await loadConflictState(db, "vietnam")) ?? emptyConflictState("vietnam");
  return {
    hasOpened: state.hasOpened,
    level: state.phaseLevel,
    westSupport: state.pressure.a ?? 0,
    eastSupport: state.pressure.b ?? 0,
    warTurns: state.phaseLevel >= 4 ? state.totalTurns : 0,
    westSpend: 0,
    eastSpend: 0,
    updatedAt: state.updatedAt,
  };
}

/**
 * One-way 1.3 cutover. Old Vietnam choice boxes close without spawning another
 * legacy rung; the combat front itself remains and is driven by the new state.
 */
export async function retireLegacyVietnamCrises(db: Db): Promise<number> {
  const legacy = await db
    .collection<Crisis>("crises")
    .find({
      status: "active",
      livingConflictEventId: { $exists: false },
      $or: [
        { "chain.family": "vietnam" },
        { templateKey: { $in: ["vietnam_us_commitment", "vietnam_ussr_commitment"] } },
      ],
    })
    .project({ _id: 1 })
    .toArray();
  if (legacy.length === 0) return 0;
  const ids = legacy.map((row) => row._id);
  const now = new Date();
  await db
    .collection<Crisis>("crises")
    .updateMany(
      { _id: { $in: ids } },
      { $set: { status: "resolved", resolvedAt: now, endTurn: null } }
    );
  await db.collection<CrisisInteraction>("crisisInteractions").updateMany(
    { crisisId: { $in: ids }, resolvedAt: null },
    {
      $set: {
        currentNodeId: null,
        decisionDeadline: null,
        resolvedAt: now,
        resolutionOutcome: "completed",
        updatedAt: now,
      },
    }
  );
  return ids.length;
}
