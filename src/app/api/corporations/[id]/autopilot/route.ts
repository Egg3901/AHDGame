/**
 * POST   /api/corporations/[id]/autopilot  — switch autopilot on
 * DELETE /api/corporations/[id]/autopilot  — switch autopilot off
 *
 * The sitting CEO stays CEO either way; autopilot only decides who sets the
 * routine levers each turn. Auth: requireBasicAuth + requireCeo. Errors: 401,
 * 403, 400, 409.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { validateAutopilotToggle, type AutopilotToggleError } from "@/lib/corporations/autopilot";
import type { Corporation } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const TOGGLE_ERROR: Record<AutopilotToggleError, string> = {
  "already-on": "Autopilot is already on.",
  "already-off": "Autopilot is already off.",
  "ceo-vacant": "The CEO seat is vacant.",
  "caretaker-run": "A caretaker runs this corporation. Resume control first.",
  "state-owned": "State-owned corporations cannot use autopilot.",
};

async function toggle(request: Request, { params }: RouteParams, enable: boolean) {
  const auth = await requireBasicAuth();
  if (!auth.ok) return auth.response;

  const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
  if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

  const db = await getDb();
  const resolved = await resolveCorporation(db, (await params).id);
  if (!resolved.ok) return resolved.response;
  const { corporation } = resolved;

  const ceoCheck = requireCeo(corporation, auth.user.userId);
  if (ceoCheck) return ceoCheck;

  const error = validateAutopilotToggle(corporation, enable);
  if (error) return errorResponse(400, TOGGLE_ERROR[error]);

  const now = new Date();
  const corporations = db.collection<Corporation>("corporations");
  // Re-assert the seat in the write: a CEO change between the read and this
  // update must not let the previous owner flip the switch.
  const seated = {
    _id: corporation._id,
    userId: corporation.userId,
    ceoVacant: { $ne: true },
  };
  const result = enable
    ? await corporations.updateOne(
        { ...seated, autopilot: { $exists: false }, ceoType: { $ne: "npp" } },
        { $set: { autopilot: { enabledTurn: await getCurrentTurn(db) }, updatedAt: now } }
      )
    : await corporations.updateOne(
        { ...seated, autopilot: { $exists: true } },
        { $unset: { autopilot: "" }, $set: { updatedAt: now } }
      );
  if (result.modifiedCount !== 1) {
    return errorResponse(409, "The corporation changed. Refresh and try again.");
  }
  return NextResponse.json({ success: true, autopilot: enable });
}

export async function POST(request: Request, context: RouteParams) {
  try {
    return await toggle(request, context, true);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, context: RouteParams) {
  try {
    return await toggle(request, context, false);
  } catch (error) {
    return handleRouteError(error);
  }
}
