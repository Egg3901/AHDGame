import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";

const schema = z.object({
  userId: z.string().min(1),
});

// POST /api/admin/users/reset-movement — Clear the movement cooldown on a user's character.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const character = await db
      .collection("characters")
      .findOne({ userId: new ObjectId(parsed.data.userId) });

    if (!character) {
      return NextResponse.json({ error: "No character found for this user" }, { status: 404 });
    }

    // Clear BOTH the legacy Date and the turn-first field; the relocation
    // cooldown check is turn-first, so leaving lastRelocatedTurn would keep the
    // cooldown active even after a "reset".
    const result = await db
      .collection("characters")
      .updateOne(
        { _id: character._id },
        { $unset: { lastRelocatedAt: "", lastRelocatedTurn: "" } }
      );

    if (result.modifiedCount === 0) {
      return NextResponse.json({ message: "No movement cooldown was active" });
    }

    return NextResponse.json({
      success: true,
      message: `Movement cooldown cleared for ${character.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
