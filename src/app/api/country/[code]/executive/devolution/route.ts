import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAuth, requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { errorResponse, handleRouteError, statusResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { changeWestminsterStance } from "@/lib/governorOffice/devolution/changeWestminsterStance";
import { loadIndependenceDesireSnapshots } from "@/lib/governorOffice/devolution/queries";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { GovernorOfficeState } from "@/lib/db/types/governorOfficeState";

import { loadWestminsterGovernment } from "@/lib/governorOffice/devolution/westminsterGovernment";

type Context = { params: Promise<{ code: string }> };

// Authenticated viewers can track public constitutional stances; only the PM can change them.
export async function GET(_request: Request, { params }: Context) {
  try {
    if ((await params).code.toUpperCase() !== "UK") return errorResponse(404, "UK-only feature.");
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const [regions, office, currentTurn, canManage, government] = await Promise.all([
      loadIndependenceDesireSnapshots(db),
      db
        .collection<GovernorOfficeState>("governorOfficeState")
        .findOne({ countryId: "UK", stateId: getNationalStateId("UK") }),
      getCurrentTurn(db),
      auth.user.character ? isSittingLeader(db, "UK", auth.user.character._id) : false,
      loadWestminsterGovernment(db),
    ]);
    return NextResponse.json({
      regions,
      currentTurn,
      canManage,
      actions: office?.gubernatorialActions ?? 0,
      stances: office?.westminsterStances ?? {},
      government,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    if ((await params).code.toUpperCase() !== "UK") return errorResponse(404, "UK-only feature.");
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(
      request,
      z
        .object({
          stateId: z.enum(["SCO", "WAL", "NIR"]),
          policy: z.enum(["anti", "pro", "independence"]),
        })
        .strict()
    );
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const db = await getDb();
    if (!(await isSittingLeader(db, "UK", auth.user.character._id))) {
      return errorResponse(403, "Only the sitting Prime Minister can change Westminster's stance.");
    }
    const result = await changeWestminsterStance(db, parsed.data);
    return statusResponse(result.status, result.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
