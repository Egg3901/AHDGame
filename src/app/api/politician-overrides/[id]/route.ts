import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { PoliticianOverride } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

const overrideSchema = z.object({
  customBio: z.string().optional(),
  customSections: z.array(z.object({ title: z.string(), content: z.string() })).optional(),
  sectionOrder: z.array(z.string()).optional(),
});

// GET /api/politician-overrides/[id] — Returns the politician profile override for a specific politician ID
// Auth: public
// Errors: 404
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();
    const override = await db
      .collection<PoliticianOverride>("politicianOverrides")
      .findOne({ politicianId: id });
    if (!override) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(override);
  } catch (error) {
    return handleRouteError(error);
  }
}

// PUT /api/politician-overrides/[id] — Creates or updates a politician profile override (admin only)
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 429
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    if (!auth.user.isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { id } = await params;
    const parsed = await parseJsonBody(request, overrideSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    const db = await getDb();
    const now = new Date();
    const existing = await db
      .collection<PoliticianOverride>("politicianOverrides")
      .findOne({ politicianId: id });

    const update: Partial<PoliticianOverride> = {
      politicianId: id,
      updatedAt: now,
    };
    if (body.customBio !== undefined) update.customBio = body.customBio;
    if (body.customSections !== undefined) update.customSections = body.customSections;
    if (body.sectionOrder !== undefined) update.sectionOrder = body.sectionOrder;

    if (existing) {
      await db
        .collection<PoliticianOverride>("politicianOverrides")
        .updateOne({ politicianId: id }, { $set: update });
    } else {
      await db.collection<PoliticianOverride>("politicianOverrides").insertOne({
        ...update,
        customBio: body.customBio,
        customSections: body.customSections,
        sectionOrder: body.sectionOrder,
      } as PoliticianOverride);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/politician-overrides/[id] — Deletes a politician profile override (admin only)
// Auth: requireBasicAuth
// Errors: 401, 403, 404, 429
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimitDel = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimitDel.ok) return rateLimitResponse(rateLimitDel.retryAfter);
    if (!auth.user.isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const { id } = await params;
    const db = await getDb();
    const result = await db
      .collection<PoliticianOverride>("politicianOverrides")
      .deleteOne({ politicianId: id });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
