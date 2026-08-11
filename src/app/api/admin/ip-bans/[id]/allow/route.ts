import { NextResponse } from "next/server";
import { ObjectId, type UpdateFilter } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { BannedIp } from "@/lib/db/types";

const patchSchema = z.union([
  z.object({
    allow: z.literal(true),
    reason: z.string().min(1).max(500),
    maxAccounts: z.number().int().min(1).max(1000),
  }),
  z.object({
    allow: z.literal(false),
  }),
]);

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/admin/ip-bans/[id]/allow — flip row between ban and allowance mode
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) throw badRequest("Invalid id.");

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const objectId = new ObjectId(id);

    // Typed $unset on Date/number fields requires the "" | 1 | true union. Declare
    // the update with UpdateFilter<BannedIp> so the driver accepts the shape.
    const update: UpdateFilter<BannedIp> = parsed.data.allow
      ? {
          $set: {
            allowRegistration: true,
            maxAccounts: parsed.data.maxAccounts,
            allowReason: parsed.data.reason,
            allowedByAdminUsername: auth.admin.username,
            allowedAt: new Date(),
          },
        }
      : {
          $unset: {
            allowRegistration: "" as const,
            maxAccounts: "" as const,
            allowReason: "" as const,
            allowedByAdminUsername: "" as const,
            allowedAt: "" as const,
          },
        };

    const result = await db
      .collection<BannedIp>("bannedIps")
      .findOneAndUpdate({ _id: objectId }, update, { returnDocument: "after" });
    if (!result) throw notFound("Row not found.");

    await createAdminLog({
      category: "system",
      action: parsed.data.allow ? "ip_rule_allowed" : "ip_rule_revoked",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: parsed.data.allow
        ? `${result.ip} → allowance (cap ${parsed.data.maxAccounts}): ${parsed.data.reason}`
        : `${result.ip} → ban (allowance revoked)`,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
