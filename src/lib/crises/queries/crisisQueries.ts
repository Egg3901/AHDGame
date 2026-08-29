import { notFound } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import type { Crisis } from "@/lib/db/types/crisis";
import { ObjectId, type Db } from "mongodb";

export interface CrisisListResult {
  crises: Crisis[];
  currentTurn: number;
  startingYear: number;
  /**
   * `GameState.preIterationTurns` (0 on normal worlds). Crisis turns are stored
   * RAW, so a display needs this to date them on the world's calendar instead of
   * a game year ahead of it (#1208).
   */
  preIterationTurns: number;
  /** `GameState.preIteration.active` — calendar pinned to the era start while true. */
  preIterationActive: boolean;
  /** State id → display name, for every region a listed crisis touches. */
  regionNames: Record<string, string>;
}

interface StateNameRow {
  _id: string;
  name?: string;
}

export async function listCrises(
  db: Db,
  scopeParam: string | null,
  statusParam: string | null
): Promise<CrisisListResult> {
  const filter: Record<string, unknown> = {};
  if (scopeParam && ["global", "country", "region"].includes(scopeParam)) {
    filter.scope = scopeParam;
  }
  if ((statusParam ?? "active") !== "all") {
    filter.status = statusParam === "resolved" ? "resolved" : "active";
  }

  const [crises, gameState] = await Promise.all([
    db.collection<Crisis>("crises").find(filter).sort({ startTurn: -1 }).toArray(),
    getGameState(db),
  ]);

  // Region ids on a crisis are State `_id`s (e.g. "FR_ARA"); resolve them to the
  // state's display name so the UI shows "Auvergne-Rhône-Alpes", not the raw code.
  const regionIds = [...new Set(crises.flatMap((c) => c.regionIds ?? []))];
  const regionNames: Record<string, string> = {};
  if (regionIds.length > 0) {
    const states = await db
      .collection<StateNameRow>("states")
      .find({ _id: { $in: regionIds } }, { projection: { name: 1 } })
      .toArray();
    for (const s of states) {
      if (s.name) regionNames[s._id] = s.name;
    }
  }

  return {
    crises,
    currentTurn: gameState?.currentTurn ?? 0,
    startingYear: gameState?.startingYear ?? STARTING_YEAR,
    preIterationTurns: gameState?.preIterationTurns ?? 0,
    preIterationActive: gameState?.preIteration?.active ?? false,
    regionNames,
  };
}

export async function getCrisisDetail(db: Db, crisisId: string): Promise<Crisis> {
  if (!ObjectId.isValid(crisisId)) {
    throw notFound("Crisis not found");
  }

  const crisis = await db.collection<Crisis>("crises").findOne({ _id: new ObjectId(crisisId) });
  if (!crisis) {
    throw notFound("Crisis not found");
  }
  return crisis;
}
