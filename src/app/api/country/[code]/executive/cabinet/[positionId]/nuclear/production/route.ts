// POST /api/country/[code]/executive/cabinet/[positionId]/nuclear/production
//
// Set the ordered warheads-per-turn rate. The order is a STANDING order the
// production turn spends against; nothing is bought here, so there is no
// funds check - a rate the budget cannot cover simply builds less each turn.
// Clamped server-side to the adopted device tier's cap: the client's slider
// bounds are a convenience, never the enforcement.
//
// Auth: defence cabinet holder or admin. Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getNuclearProgram, putNuclearProgram } from "@/lib/db/collections/nuclearPrograms";
import { productionCapFor } from "@/lib/military/nuclearProgram";
import { requireDefenceHolder, requireEligible, type NuclearRouteParams } from "../shared";

const productionSchema = z.object({ rate: z.number().int().min(0) });

export async function POST(request: Request, { params }: NuclearRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const gate = await requireEligible(db, countryId);
    if ("error" in gate) return gate.error;

    const parsed = await parseJsonBody(request, productionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const program = await getNuclearProgram(db, countryId);
    const cap = productionCapFor(program.adopted);
    const rate = Math.max(0, Math.min(parsed.data.rate, cap));

    await putNuclearProgram(db, { ...program, productionRate: rate });
    return NextResponse.json({ productionRate: rate, productionCap: cap });
  } catch (error) {
    return handleRouteError(error);
  }
}
