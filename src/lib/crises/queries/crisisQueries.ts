import { notFound } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import type { Crisis } from "@/lib/db/types/crisis";
import { ObjectId, type Db } from "mongodb";

export interface CrisisListResult {
  crises: Crisis[];
  currentTurn: number;
  startingYear: number;
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

  return {
    crises,
    currentTurn: gameState?.currentTurn ?? 0,
    startingYear: gameState?.startingYear ?? STARTING_YEAR,
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
