/**
 * POST /api/admin/national-party-elections
 *   body: { action: "batch-resolve" | "batch-create", durationTurns?: number }
 *   batch-resolve: force-resolve all national elections whose endTurn <= currentTurn.
 *   batch-create:  create missing elections for all party × position combos.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import {
  processCompletedNationalElections,
  createMissingNationalElections,
  NATIONAL_ELECTION_DURATION_TURNS,
} from "@/lib/nationalPartyElections";
import { getGameTime } from "@/lib/time/gameTime";

const batchSchema = z.object({
  action: z.enum(["batch-resolve", "batch-create"]),
  durationTurns: z.number().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, batchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action, durationTurns } = parsed.data;

    const { currentTurn, effectiveNow } = await getGameTime();

    if (action === "batch-resolve") {
      const resolved = await processCompletedNationalElections(currentTurn, effectiveNow);
      return NextResponse.json({
        success: true,
        message: `Resolved ${resolved} national party election(s).`,
        resolved,
      });
    }

    if (action === "batch-create") {
      const duration =
        typeof durationTurns === "number" && durationTurns > 0
          ? durationTurns
          : NATIONAL_ELECTION_DURATION_TURNS;
      const created = await createMissingNationalElections(currentTurn, duration, effectiveNow);
      return NextResponse.json({
        success: true,
        message: `Created ${created} missing national party election(s) (${duration} turns each).`,
        created,
      });
    }

    return NextResponse.json(
      { error: "action must be batch-resolve or batch-create" },
      { status: 400 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
