// GET /api/country/[code]/executive/cabinet/[positionId]/nuclear/covert
//
// The covert programme's status surface: the hidden state, the stage ladder,
// the current discovery odds and the funding menu. SECRET: this renders only
// inside the defence seat's own panel, and any country outside the covert set
// gets a bare {eligible:false} with nothing else attached.
//
// Auth: defence cabinet holder or admin. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getCovertNuclearProgram } from "@/lib/db/collections/covertNuclearPrograms";
import {
  COVERT_CAPABLE,
  COVERT_STAGES,
  FUNDING_COST,
  FUNDING_PROGRESS,
  STAGE_PROGRESS,
  discoveryChance,
} from "@/lib/military/covertNuclear";
import { loadGameStateSlice, requireDefenceHolder, type NuclearRouteParams } from "../shared";

export async function GET(request: Request, { params }: NuclearRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId, { intent: "read" });
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const gs = await loadGameStateSlice(db);
    if (!COVERT_CAPABLE.includes(countryId) || gs?.coldWarEnabled !== true) {
      // Nothing to see: no state, no stages, no hint the surface exists.
      return NextResponse.json({ eligible: false }, { status: 404 });
    }

    const program = await getCovertNuclearProgram(db, countryId);
    return NextResponse.json({
      eligible: true,
      state: {
        stage: program.stage,
        progress: program.progress,
        funding: program.funding,
        suspicion: program.suspicion,
        exposureCount: program.exposureCount,
        startedTurn: program.startedTurn ?? null,
        completed: program.completed,
        brokenOutTurn: program.brokenOutTurn ?? null,
      },
      stages: COVERT_STAGES,
      stageProgress: STAGE_PROGRESS,
      discoveryChance: discoveryChance(program.suspicion),
      fundingOptions: (Object.keys(FUNDING_COST) as Array<keyof typeof FUNDING_COST>).map(
        (key) => ({
          key,
          cost: FUNDING_COST[key],
          progress: FUNDING_PROGRESS[key],
        })
      ),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
