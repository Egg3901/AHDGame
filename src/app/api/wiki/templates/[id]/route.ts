import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import type { WikiTemplate } from "@/lib/db/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/wiki/templates/[id] — Returns a single wiki template by its ID.
// Auth: public; blocked when wiki is disabled
// Errors: 403, 404
export async function GET(request: Request, context: RouteContext) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;
    const { id } = await context.params;

    const db = await getDb();
    const template = await db.collection<WikiTemplate>("wikiTemplates").findOne({ _id: id });

    if (!template) {
      return NextResponse.json(notFound().toJson(), { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (error) {
    return handleRouteError(error);
  }
}
