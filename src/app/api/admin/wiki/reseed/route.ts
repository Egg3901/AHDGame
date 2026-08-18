import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { seedWikiPages } from "@/lib/seeds/wiki";

const reseedSchema = z.object({
  force: z.boolean().optional(),
  slugs: z
    .array(z.string().regex(/^[a-z0-9-]+$/))
    .min(1)
    .max(200)
    .optional(),
});

// POST /api/admin/wiki/reseed — Upserts wiki pages from the seed list. Non-destructive by default; pages with human edits are skipped unless `force` is true.
// Auth: requireAdmin
// Errors: 400, 403
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, reseedSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const adminId = new ObjectId(auth.admin.userId);
    const result = await seedWikiPages(db, adminId, {
      force: parsed.data.force,
      slugs: parsed.data.slugs,
    });

    // Invalidate the wiki landing page cache so seeded pages appear immediately.
    revalidatePath("/wiki");

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
