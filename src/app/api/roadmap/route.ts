import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";

// GET /api/roadmap — Returns all public roadmap items and categories.
// Auth: public
// Errors: (none)
export async function GET() {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const db = await getDb();
    const [items, categories] = await Promise.all([
      db.collection("roadmapItems").find({}).sort({ phase: 1, sortOrder: 1 }).toArray(),
      db.collection("roadmapCategories").find({}).sort({ sortOrder: 1 }).toArray(),
    ]);

    return NextResponse.json({ items, categories });
  } catch (err) {
    return handleRouteError(err);
  }
}
