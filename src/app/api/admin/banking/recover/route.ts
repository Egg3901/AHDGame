import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getCurrentTurn } from "@/lib/currentTurn";
import { recoverBankingSettlements } from "@/lib/banking/recovery";

// POST /api/admin/banking/recover - finish settlements and estate resolutions
// that earlier turns left unfinished. The same pass the banking turn runs
// first; here on demand, for an operator looking at the health report.
// Auth: requireAdmin only.
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const turn = await getCurrentTurn(db);
    // Records from the current turn may belong to a pass still running, so
    // the worker only touches earlier turns; an admin run treats "now" as the
    // turn after the current one to include the current turn's leftovers.
    return NextResponse.json(await recoverBankingSettlements(db, turn + 1));
  } catch (error) {
    return handleRouteError(error);
  }
}
