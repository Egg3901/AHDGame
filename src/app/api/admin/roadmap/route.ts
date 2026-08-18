import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";

const createRoadmapItemSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  phase: z.enum(["alpha", "beta", "release"]),
  category: z.string().optional(),
  subcategory: z.string().optional(),
});

// GET /api/admin/roadmap — Lists all roadmap items in phase and sort order.
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const items = await db
      .collection("roadmapItems")
      .find({})
      .sort({ phase: 1, sortOrder: 1 })
      .toArray();

    return NextResponse.json({ items });
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/admin/roadmap — Creates a new roadmap item in the specified phase.
// Auth: requireAdmin
// Errors: 400, 403
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, createRoadmapItemSchema);
    if (!parsed.success) {
      return NextResponse.json(badRequest(parsed.error).toJson(), { status: parsed.status });
    }
    const { title, description, phase, category, subcategory } = parsed.data;

    const db = await getDb();
    const col = db.collection("roadmapItems");

    // Get max sortOrder for this phase
    const last = await col.findOne({ phase }, { sort: { sortOrder: -1 } });
    const sortOrder = (last?.sortOrder ?? -1) + 1;

    const doc: Record<string, unknown> = {
      title,
      description: description || undefined,
      phase,
      status: "planned",
      sortOrder,
      createdAt: new Date(),
    };
    if (category) doc.category = category;
    if (subcategory) doc.subcategory = subcategory;

    const result = await col.insertOne(doc);

    return NextResponse.json({ id: result.insertedId }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
