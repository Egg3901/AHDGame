import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { createAdminLog } from "@/lib/adminLog";

const schema = z.object({ userId: z.string().length(24), granted: z.boolean() });

/**
 * Grant or revoke sandbox tester access for one account. Writes only the
 * sandbox grant fields, never any supporter field, so a tester gets the
 * sandbox link and no supporter perk.
 */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const { userId, granted } = parsed.data;
    const db = await getDb();
    const _id = new ObjectId(userId);
    const user = await db.collection("users").findOne({ _id }, { projection: { username: 1 } });
    if (!user) return errorResponse(404, "User not found");

    await db.collection("users").updateOne(
      { _id },
      granted
        ? {
            $set: {
              sandboxAccessGrantedAt: new Date(),
              sandboxAccessGrantedBy: auth.admin.username,
              updatedAt: new Date(),
            },
          }
        : {
            $unset: { sandboxAccessGrantedAt: "", sandboxAccessGrantedBy: "" },
            $set: { updatedAt: new Date() },
          }
    );
    await createAdminLog({
      category: "account",
      action: granted ? "sandbox_access_granted" : "sandbox_access_revoked",
      username: user.username,
      adminUsername: auth.admin.username,
    });
    return NextResponse.json({ success: true, granted });
  } catch (error) {
    return handleRouteError(error);
  }
}
