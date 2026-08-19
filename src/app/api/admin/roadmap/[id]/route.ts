import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";

const updateRoadmapItemSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["planned", "in-progress", "completed"]).optional(),
  sortOrder: z.number().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
});

// PATCH /api/admin/roadmap/[id] — Updates a roadmap item's title, description, status, sort order, or category.
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

    const parsed = await parseJsonBody(request, updateRoadmapItemSchema);
    if (!parsed.success) {
      return NextResponse.json(badRequest(parsed.error).toJson(), { status: parsed.status });
    }
    const body = parsed.data;

    const update: Record<string, unknown> = {};
    const unset: Record<string, string> = {};

    if (body.title !== undefined) update.title = body.title;
    if (body.description !== undefined) update.description = body.description || undefined;
    if (body.sortOrder !== undefined) update.sortOrder = body.sortOrder;

    if (body.status !== undefined) {
      update.status = body.status;
      if (body.status === "completed") {
        update.completedAt = new Date();
      } else {
        update.completedAt = undefined;
      }
    }

    // Category: pass null to clear, string to set
    if (body.category !== undefined) {
      if (body.category === null) {
        unset.category = "";
        unset.subcategory = "";
      } else {
        update.category = body.category;
      }
    }
    if (body.subcategory !== undefined) {
      if (body.subcategory === null) {
        unset.subcategory = "";
      } else {
        update.subcategory = body.subcategory;
      }
    }

    if (Object.keys(update).length === 0 && Object.keys(unset).length === 0) {
      return NextResponse.json(badRequest("No fields to update").toJson(), { status: 400 });
    }

    const db = await getDb();
    const op: Record<string, unknown> = {};
    if (Object.keys(update).length > 0) op.$set = update;
    if (Object.keys(unset).length > 0) op.$unset = unset;

    const result = await db.collection("roadmapItems").updateOne({ _id: new ObjectId(id) }, op);

    if (result.matchedCount === 0) {
      return NextResponse.json(notFound("Item not found").toJson(), { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}

// DELETE /api/admin/roadmap/[id] — Permanently deletes a roadmap item by ID.
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
    const result = await db.collection("roadmapItems").deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return NextResponse.json(notFound("Item not found").toJson(), { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
