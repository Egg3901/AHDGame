import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";

const updateCategorySchema = z.object({
  name: z.string().optional(),
  subcategories: z.array(z.string()).optional(),
  sortOrder: z.number().optional(),
});

// PATCH /api/admin/roadmap/categories/[id] — Updates a roadmap category's name, subcategories, or sort order.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json(badRequest("Invalid ID").toJson(), { status: 400 });
    }

    const parsed = await parseJsonBody(request, updateCategorySchema);
    if (!parsed.success) {
      return NextResponse.json(badRequest(parsed.error).toJson(), { status: parsed.status });
    }
    const body = parsed.data;

    const update: Record<string, unknown> = {};

    if (body.name !== undefined) update.name = body.name.trim();
    if (body.subcategories !== undefined) {
      update.subcategories = body.subcategories.map((s) => s.trim()).filter(Boolean);
    }
    if (body.sortOrder !== undefined) update.sortOrder = body.sortOrder;

    if (Object.keys(update).length === 0) {
      return NextResponse.json(badRequest("No fields to update").toJson(), { status: 400 });
    }

    const db = await getDb();
    const result = await db
      .collection("roadmapCategories")
      .updateOne({ _id: new ObjectId(id) }, { $set: update });

    if (result.matchedCount === 0) {
      return NextResponse.json(notFound("Category not found").toJson(), { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}

// DELETE /api/admin/roadmap/categories/[id] — Deletes a roadmap category and clears its assignment from related items.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json(badRequest("Invalid ID").toJson(), { status: 400 });
    }

    const db = await getDb();
    const cat = await db.collection("roadmapCategories").findOne({ _id: new ObjectId(id) });
    if (!cat) {
      return NextResponse.json(notFound("Category not found").toJson(), { status: 404 });
    }

    // Unset category/subcategory from items using this category
    await db
      .collection("roadmapItems")
      .updateMany({ category: cat.name }, { $unset: { category: "", subcategory: "" } });

    await db.collection("roadmapCategories").deleteOne({ _id: new ObjectId(id) });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
