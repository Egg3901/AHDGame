/**
 * POST   /api/corporations/[id]/ceo/caretaker  — install an NPP caretaker CEO
 * DELETE /api/corporations/[id]/ceo/caretaker  — dismiss the caretaker, reclaim
 *
 * Player-appointed caretaker CEO (NPP-autonomy V2.1). Only the sitting human CEO
 * (the corp owner, via `requireCeo`) may install or dismiss a caretaker, and the
 * country's NPP-autonomy level must be active for this country
 * (`nppAutonomyAtLeast(v1)` — true for autonomy countries at v1, player
 * countries at v2). Auth: requireBasicAuth + requireCeo. Errors: 401, 403, 400.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import {
  appointCaretakerCeo,
  dismissCaretakerCeo,
  type CaretakerAppointmentError,
} from "@/lib/corporations/caretakerCeo";
import { z } from "zod";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const appointSchema = z.object({ nppId: z.string().length(24).optional() });
const mandateSchema = z.object({ mandate: z.enum(["active", "passive"]) });

/** Map a caretaker-appointment error code to an HTTP response. */
function appointmentErrorResponse(error: CaretakerAppointmentError): NextResponse {
  switch (error) {
    case "corp-not-found":
      return errorResponse(404, "Corporation not found");
    case "already-caretaker":
      return errorResponse(400, "This corporation already has a caretaker CEO.");
    case "ceo-vacant":
      return errorResponse(400, "The CEO seat is vacant — appoint a CEO before a caretaker.");
    case "ceo-not-character":
      return errorResponse(400, "Only a sitting CEO can hand the corporation to a caretaker.");
    case "reclaim-cooldown":
      return errorResponse(
        400,
        "You recently reclaimed this corporation. Wait until the caretaker cooldown ends before handing it off again."
      );
    case "no-eligible-npp":
      return errorResponse(400, "No eligible caretaker is available in this country right now.");
    case "npp-not-eligible":
      return errorResponse(400, "That caretaker is not available.");
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, appointSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Only the owning CEO may install a caretaker.
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    // Feature gate: NPP autonomy must be active for this corp's country.
    if (!(await nppAutonomyAtLeast(db, corporation.countryId, "v1"))) {
      return errorResponse(403, "Caretaker CEOs are not enabled in this country.");
    }

    const turn = await getCurrentTurn(db);
    const result = await appointCaretakerCeo(db, {
      corp: corporation,
      forcedNppId: parsed.data.nppId,
      turn,
      now: new Date(),
    });
    if (!result.ok) return appointmentErrorResponse(result.error!);

    return NextResponse.json({ success: true, nppId: result.nppId, nppName: result.nppName });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // `userId` is preserved while a caretaker sits, so the appointing owner still
    // passes requireCeo and can reclaim.
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const turn = await getCurrentTurn(db);
    const result = await dismissCaretakerCeo(db, { corp: corporation, turn, now: new Date() });
    if (!result.ok) {
      if (result.error === "one-person-rule") {
        return errorResponse(
          403,
          "This player already operates another subsidiary of the same parent."
        );
      }
      return errorResponse(400, "This corporation does not have a caretaker CEO.");
    }

    return NextResponse.json({ success: true, restoredCharacterId: result.restoredCharacterId });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const parsed = await parseJsonBody(request, mandateSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const resolved = await resolveCorporation(db, (await params).id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;
    if (!corporation.caretakerCeo) {
      return errorResponse(400, "This corporation does not have a caretaker CEO.");
    }

    const update = await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id, "caretakerCeo.underlyingUserId": corporation.userId },
        { $set: { "caretakerCeo.mandate": parsed.data.mandate, updatedAt: new Date() } }
      );
    if (update.modifiedCount !== 1) {
      return errorResponse(409, "Caretaker changed. Refresh and try again.");
    }
    return NextResponse.json({ success: true, mandate: parsed.data.mandate });
  } catch (error) {
    return handleRouteError(error);
  }
}
