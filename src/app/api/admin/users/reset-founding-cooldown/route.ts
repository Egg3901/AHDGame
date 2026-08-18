import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { User } from "@/lib/db/types";

const schema = z.object({
  userId: z.string().min(1),
});

// POST /api/admin/users/reset-founding-cooldown — Clear the corporation-founding cooldown on a user.
// Auth: requireAdmin
// Errors: 400, 403, 404
//
// The founding cooldown (Bug #0728) is deliberately per-USER, not per-character:
// it blocks the found -> drain -> abandon -> found rotation, and scoping it to
// the character would let a reroll dodge it. That means a player who founds a
// corp and then retires keeps the cooldown on their new character — working as
// designed, but with no way for staff to grant an exception. `reset-movement`
// had this escape hatch for relocation; founding did not, so the only remedy
// was a direct Mongo write. This closes that gap.
//
// Grant sparingly on production: waiving it hands back the exact exploit the
// cooldown exists to prevent. The common legitimate case is a freshly reset
// sandbox, where the 168-turn cooldown outlives the test world.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    if (!ObjectId.isValid(parsed.data.userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const db = await getDb();
    const userId = new ObjectId(parsed.data.userId);
    const user = await db.collection<User>("users").findOne({ _id: userId });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.lastCorporationFoundedTurn == null) {
      return NextResponse.json({ message: "No founding cooldown was active" });
    }

    await db
      .collection<User>("users")
      .updateOne({ _id: userId }, { $unset: { lastCorporationFoundedTurn: "" } });

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "founding_cooldown_reset",
      username: user.username,
      adminUsername: auth.admin.username,
      details: `Cleared corporation-founding cooldown for ${user.username} (was set at turn ${user.lastCorporationFoundedTurn}).`,
      createdAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: `Corporation-founding cooldown cleared for ${user.username}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
