import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ManualOfficeHistoryEntry } from "@/lib/db/types/manualOfficeHistory";
import {
  isoDateSchema,
  isoDateToUtcNoon,
  assertTenureFields,
} from "@/lib/wiki/officeHistoryValidation";

export const officeHistoryBodySchema = z.object({
  countryId: z.string(),
  officeKind: z.enum(["executive", "cabinet", "leadership"]),
  officeType: z.string().optional(),
  positionId: z.string().optional(),
  leadershipRole: z.string().optional(),
  iteration: z.object({
    type: z.enum(["Alpha", "Beta", "Iteration"]),
    number: z.number().int().min(1),
  }),
  name: z.string().min(1),
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

// POST /api/wiki/office-history - Create a curated manual office-history entry.
// Auth: requireAdmin
// Errors: 400, 403
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const parsed = await parseJsonBody(request, officeHistoryBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { startDate, endDate, ...d } = parsed.data;
    if (!COUNTRY_CONFIGS[d.countryId as CountryId]) {
      throw badRequest("Invalid countryId");
    }
    assertTenureFields({ startWeek: d.startWeek, startYear: d.startYear, startDate });

    const isIncumbent = d.isIncumbent === true;
    if (isIncumbent) {
      delete d.endWeek;
      delete d.endYear;
    }

    const officeId = d.officeType ?? d.positionId ?? d.leadershipRole ?? "unknown";
    const officeKey = `${d.countryId}:${d.officeKind}:${officeId}`;
    const now = new Date();
    const db = await getDb();
    const doc = {
      ...d,
      countryId: d.countryId as CountryId,
      officeKey,
      ...(startDate ? { startDate: isoDateToUtcNoon(startDate) } : {}),
      ...(!isIncumbent && endDate ? { endDate: isoDateToUtcNoon(endDate) } : {}),
      createdBy: auth.admin.username,
      createdAt: now,
      updatedAt: now,
    } as Omit<ManualOfficeHistoryEntry, "_id">;

    const res = await db
      .collection<ManualOfficeHistoryEntry>("manualOfficeHistory")
      .insertOne(doc as ManualOfficeHistoryEntry);
    return NextResponse.json({ success: true, id: res.insertedId.toString() });
  } catch (error) {
    return handleRouteError(error);
  }
}
