import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import type { ManualOfficeHistoryEntry } from "@/lib/db/types/manualOfficeHistory";
import {
  isoDateSchema,
  isoDateToUtcNoon,
  assertTenureFields,
} from "@/lib/wiki/officeHistoryValidation";

type RouteContext = { params: Promise<{ id: string }> };

// Edit submits the full editable state, so tenure fields use replace semantics:
// present → $set, absent → $unset (lets an admin clear a date or week/year).
const patchSchema = z.object({
  iteration: z
    .object({ type: z.enum(["Alpha", "Beta", "Iteration"]), number: z.number().int().min(1) })
    .optional(),
  name: z.string().min(1).optional(),
  party: z.string().optional(),
  profileHref: z.string().optional(),
  startWeek: z.number().int().min(1).max(52).optional(),
  startYear: z.number().int().optional(),
  endWeek: z.number().int().min(1).max(52).optional(),
  endYear: z.number().int().optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  isIncumbent: z.boolean().optional(),
  order: z.number().int().optional(),
});

// PATCH /api/wiki/office-history/[id] - Update a curated manual office-history entry.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const { id } = await params;
    if (!ObjectId.isValid(id)) throw badRequest("Invalid id");

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { startDate, endDate, ...d } = parsed.data;
    assertTenureFields({ startWeek: d.startWeek, startYear: d.startYear, startDate });

    const isIncumbent = d.isIncumbent === true;
    const set: Record<string, unknown> = { updatedAt: new Date(), isIncumbent };
    const unset: Record<string, unknown> = {};

    for (const key of ["name", "party", "profileHref", "iteration", "order"] as const) {
      if (d[key] !== undefined) set[key] = d[key];
    }
    // Tenure fields: present → set, absent (or cleared by incumbency) → unset.
    const place = (key: string, value: unknown, keep: boolean) => {
      if (keep && value != null) set[key] = value;
      else unset[key] = "";
    };
    place("startWeek", d.startWeek, true);
    place("startYear", d.startYear, true);
    place("endWeek", d.endWeek, !isIncumbent);
    place("endYear", d.endYear, !isIncumbent);
    place("startDate", isoDateToUtcNoon(startDate), true);
    place("endDate", isoDateToUtcNoon(endDate), !isIncumbent);

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    const db = await getDb();
    const result = await db
      .collection<ManualOfficeHistoryEntry>("manualOfficeHistory")
      .updateOne({ _id: new ObjectId(id) }, update);
    if (result.matchedCount === 0) throw notFound("Office history entry not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/wiki/office-history/[id] - Delete a curated manual office-history entry.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const { id } = await params;
    if (!ObjectId.isValid(id)) throw badRequest("Invalid id");

    const db = await getDb();
    const result = await db
      .collection<ManualOfficeHistoryEntry>("manualOfficeHistory")
      .deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) throw notFound("Office history entry not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
