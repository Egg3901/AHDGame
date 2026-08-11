import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { loadNPPContext } from "@/lib/turn/npp/context";
import { processElectionEntry } from "@/lib/turn/npp/electionEntry";

// POST /api/admin/npps/reenter-primaries — Forces NPPs to re-enter primaries based on current eligibility rules
// Auth: requireAdmin
// Errors: 401, 403
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const forceEntry = url.searchParams.get("forceEntry") === "true";

    const now = new Date();

    // Load full NPP context, optionally including elections past primary phase
    const ctx = await loadNPPContext(now, { includeGeneralPhase: forceEntry });

    // Run election entry logic
    const entered = await processElectionEntry(ctx);

    return NextResponse.json({
      success: true,
      entered,
      forceEntry,
      openPrimaries: ctx.openPrimaries.length,
      availableNPPs: ctx.allNPPs.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
