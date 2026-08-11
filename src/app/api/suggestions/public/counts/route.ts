import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
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

// GET /api/suggestions/public/counts — Status counts for suggestion board tabs.
// Auth: public
export async function GET() {
  try {
    const db = await getDb();
    const coll = getSuggestionsCollection(db);
    const grouped = await coll
      .aggregate<{ _id: string | null; count: number }>([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
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
