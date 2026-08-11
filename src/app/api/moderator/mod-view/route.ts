import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModerator } from "@/lib/api/requireModerator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { createModAuditLog } from "@/lib/modAuditLog";

const modViewSchema = z.object({
  targetType: z.enum(["corporation", "party"]),
  targetId: z.string().min(1).max(120),
  targetName: z.string().min(1).max(200),
  countryId: z.string().min(2).max(8).optional(),
});

// POST /api/moderator/mod-view - Audit a moderator unlocking restricted page views.
// Auth: requireModerator
// Errors: 400, 403
export async function POST(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, modViewSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { targetType, targetId, targetName, countryId } = parsed.data;
    const isAdmin = auth.user.isAdmin === true;
    const action =
      targetType === "corporation"
        ? isAdmin
          ? "admin_view_private_corporation"
          : "view_private_corporation"
        : "view_party_mod_view";
    const actorLabel = isAdmin ? "Administrator" : "Moderator";
    const details =
      targetType === "corporation"
        ? `${actorLabel} unlocked private corporation view for ${targetName} (${targetId}).`
        : `Unlocked party mod view for ${targetName} (${countryId ?? "??"}:${targetId}).`;

    await createModAuditLog({
      moderatorId: auth.user.userId,
      moderatorName: auth.user.username,
      action,
      details,
      targetUsername: targetName,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
