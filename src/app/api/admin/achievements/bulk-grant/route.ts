import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Character } from "@/lib/db/types";
import { awardAchievement } from "@/lib/achievements";

const bulkGrantSchema = z.object({
  achievementSlug: z.string().min(1),
});

// POST /api/admin/achievements/bulk-grant — Grants a specified achievement to all existing characters.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bulkGrantSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { achievementSlug } = parsed.data;
    const db = await getDb();

    const achievement = await db.collection("achievements").findOne({ slug: achievementSlug });
    if (!achievement) {
      return NextResponse.json({ error: "Achievement not found" }, { status: 404 });
    }

    const characters = await db.collection<Character>("characters").find({}).toArray();
    let granted = 0;
    for (const char of characters) {
      const ok = await awardAchievement(
        char.userId,
        achievementSlug,
        char._id,
        auth.admin.character?._id
      );
      if (ok) granted++;
    }

    return NextResponse.json({
      success: true,
      granted,
      total: characters.length,
      message: `Achievement "${achievementSlug}" granted to ${granted} of ${characters.length} characters.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
