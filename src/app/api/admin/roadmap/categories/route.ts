import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";

const createCategorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  subcategories: z.array(z.string()).optional(),
});

// GET /api/admin/roadmap/categories — Lists all roadmap categories in sort order.
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const categories = await db
      .collection("roadmapCategories")
      .find({})
      .sort({ sortOrder: 1 })
      .toArray();

    return NextResponse.json({ categories });
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/admin/roadmap/categories — Creates a new roadmap category.
// Auth: requireAdmin
// Errors: 400, 403
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, createCategorySchema);
    if (!parsed.success) {
      return NextResponse.json(badRequest(parsed.error).toJson(), { status: parsed.status });
    }
    const { name, subcategories } = parsed.data;

    const db = await getDb();
    const col = db.collection("roadmapCategories");

    // Check for duplicate name
    const existing = await col.findOne({ name: name.trim() });
    if (existing) {
      return NextResponse.json(badRequest("Category already exists").toJson(), { status: 400 });
    }

    // Get max sortOrder
    const last = await col.findOne({}, { sort: { sortOrder: -1 } });
    const sortOrder = (last?.sortOrder ?? -1) + 1;

    const result = await col.insertOne({
      name: name.trim(),
      subcategories: Array.isArray(subcategories)
        ? subcategories.map((s) => s.trim()).filter(Boolean)
        : [],
      sortOrder,
    });

    return NextResponse.json({ id: result.insertedId }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
