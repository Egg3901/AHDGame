// POST /api/country/[code]/executive/cabinet/[positionId]/nuclear/covert/funding
//
// Set the covert programme's funding level. The first non-none level stamps
// startedTurn: the moment the DDR chose to build. Money is not drawn here;
// the turn hook draws each turn's cost from the defence appropriation.
//
// Auth: defence cabinet holder or admin. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import {
  getCovertNuclearProgram,
  putCovertNuclearProgram,
} from "@/lib/db/collections/covertNuclearPrograms";
import { COVERT_CAPABLE } from "@/lib/military/covertNuclear";
import { loadGameStateSlice, requireDefenceHolder, type NuclearRouteParams } from "../../shared";

const fundingSchema = z.object({ funding: z.enum(["none", "trickle", "steady", "crash"]) });

export async function POST(request: Request, { params }: NuclearRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId, {
      capability: "strategicCommitment",
    });
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const gs = await loadGameStateSlice(db);
    if (!COVERT_CAPABLE.includes(countryId) || gs?.coldWarEnabled !== true) {
      return NextResponse.json({ eligible: false }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, fundingSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const program = await getCovertNuclearProgram(db, countryId);
    if (program.completed) {
      return NextResponse.json(
        { error: "The device is assembled. There is nothing left to fund." },
        { status: 409 }
      );
    }

    const funding = parsed.data.funding;
    const startedTurn =
      program.startedTurn ?? (funding !== "none" ? (gs.currentTurn ?? 0) : undefined);
    await putCovertNuclearProgram(db, { ...program, funding, startedTurn });

    return NextResponse.json({ funding, startedTurn: startedTurn ?? null });
  } catch (error) {
    return handleRouteError(error);
  }
}
