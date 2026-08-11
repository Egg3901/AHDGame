import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { BannedIp } from "@/lib/db/types";

const patchSchema = z.object({
  note: z.string().min(1).max(500).optional(),
  maxAccounts: z.number().int().min(1).max(1000).optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

// DELETE /api/admin/ip-bans/[id] — remove a row (ban or allowance)
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) throw badRequest("Invalid id.");

    const db = await getDb();
    const result = await db
      .collection<BannedIp>("bannedIps")
      .findOneAndDelete({ _id: new ObjectId(id) });
    if (!result) throw notFound("Row not found.");

    await createAdminLog({
      category: "system",
      action: "ip_rule_deleted",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: `Removed ${result.allowRegistration ? "allowance" : "ban"} for ${result.ip}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/ip-bans/[id] — edit note or maxAccounts
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

    const update: Record<string, unknown> = {};
    if (parsed.data.note !== undefined) update.note = parsed.data.note;
    if (parsed.data.maxAccounts !== undefined) update.maxAccounts = parsed.data.maxAccounts;
    if (Object.keys(update).length === 0) throw badRequest("Nothing to update.");

    const db = await getDb();
    const result = await db
      .collection<BannedIp>("bannedIps")
      .findOneAndUpdate({ _id: new ObjectId(id) }, { $set: update }, { returnDocument: "after" });
    if (!result) throw notFound("Row not found.");

    await createAdminLog({
      category: "system",
      action: "ip_rule_edited",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: `Edited ${result.ip}: ${Object.keys(update).join(", ")}`,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
