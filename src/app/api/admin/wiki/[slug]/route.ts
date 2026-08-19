import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { updateWikiPageSchema } from "@/lib/api/schemas/wiki";
import type { WikiPage } from "@/lib/db/types";
import { ObjectId } from "mongodb";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

// PATCH /api/admin/wiki/[slug] — Updates fields on an existing wiki page by slug.
// Auth: requireModerator (admins and moderators may edit any page)
// Errors: 400, 403, 404
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { slug } = await context.params;

    const parsed = await parseJsonBody(request, updateWikiPageSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const wikiPages = db.collection<WikiPage>("wikiPages");

    const existing = await wikiPages.findOne({ slug });
    if (!existing) {
      return NextResponse.json(notFound().toJson(), { status: 404 });
    }

    const now = new Date();
    const adminId = new ObjectId(auth.user.userId);
    const { editHistory: _omit, ...fieldsToUpdate } = parsed.data as Partial<WikiPage>;
    await wikiPages.updateOne(
      { slug },
      {
        $set: { ...fieldsToUpdate, updatedAt: now },
        $push: {
          editHistory: { userId: adminId, timestamp: now, action: "edited" },
        },
      }
    );
    const updated = await wikiPages.findOne({ slug });

    revalidatePath(`/wiki/${slug}`);
    return NextResponse.json({ success: true, page: updated, slug: updated?.slug });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/admin/wiki/[slug] — Archives a wiki page by slug (soft delete, sets status to archived).
// Auth: requireModerator (admins and moderators may archive pages)
// Errors: 403, 404
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { slug } = await context.params;

    const db = await getDb();
    const wikiPages = db.collection<WikiPage>("wikiPages");

    const existing = await wikiPages.findOne({ slug });
    if (!existing) {
      return NextResponse.json(notFound().toJson(), { status: 404 });
    }

    const now = new Date();
    const adminId = new ObjectId(auth.user.userId);
    await wikiPages.updateOne(
      { slug },
      {
        $set: {
          status: "archived",
          updatedAt: now,
          editHistory: [
            ...(existing.editHistory || []),
            {
              userId: adminId,
              timestamp: now,
              action: "archived",
            },
          ],
        },
      }
    );

    revalidatePath(`/wiki/${slug}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
