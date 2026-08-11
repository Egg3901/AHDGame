import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { SuggestionStatus } from "@/lib/db/types/suggestion";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";

const STATUSES: SuggestionStatus[] = [
  "not_reviewed",
  "planned",
  "in_progress",
  "completed",
  "not_implementing",
];

// GET /api/admin/suggestions/counts — Status histogram (one DB round-trip for admin tabs).
// Auth: requireAdmin
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const coll = getSuggestionsCollection(db);
    const grouped = await coll
      .aggregate<{
        _id: string;
        count: number;
      }>([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      .toArray();

    const counts: Record<string, number> = {};
    for (const s of STATUSES) counts[s] = 0;
    let total = 0;
    for (const row of grouped) {
      if (row._id == null) continue;
      const k = String(row._id) as SuggestionStatus;
      if (STATUSES.includes(k)) counts[k] = row.count;
      total += row.count;
    }

    return NextResponse.json({ counts, total });
  } catch (err) {
    return handleRouteError(err);
  }
}
