import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { createAdminLog } from "@/lib/adminLog";

const schema = z.object({ userId: z.string().length(24), entitled: z.boolean() });

/** Grant or revoke official desktop singleplayer access for one account. */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { userId, entitled } = parsed.data;
    const db = await getDb();
    const _id = new ObjectId(userId);
    const user = await db.collection("users").findOne({ _id }, { projection: { username: 1 } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    await db.collection("users").updateOne(
      { _id },
      entitled
        ? {
            $set: {
              singleplayerEntitledAt: new Date(),
              singleplayerEntitledBy: auth.admin.username,
              updatedAt: new Date(),
            },
          }
        : {
            $unset: { singleplayerEntitledAt: "", singleplayerEntitledBy: "" },
            $set: { updatedAt: new Date() },
          }
    );
    await createAdminLog({
      category: "account",
      action: entitled ? "singleplayer_entitlement_granted" : "singleplayer_entitlement_revoked",
      username: user.username,
      adminUsername: auth.admin.username,
    });
    return NextResponse.json({ success: true, entitled });
  } catch (error) {
    return handleRouteError(error);
  }
}
