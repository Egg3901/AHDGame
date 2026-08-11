import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { NPP } from "@/lib/db/types";
import { escapeRegex } from "@/lib/utils/escapeRegex";

// GET /api/settings/supporter-requests/npp-search?q= — search active NPPs by
// name substring for the Supporter++ rename form.
// Auth: requireBasicAuth
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return NextResponse.json(
        { error: "Search query must be at least 2 characters." },
        {
          status: 400,
        }
      );
    }

    const db = await getDb();
    const npps = await db
      .collection<NPP>("npps")
      .find({
        name: { $regex: escapeRegex(q), $options: "i" },
        retiredAt: null,
      })
      .project<
        Pick<NPP, "_id" | "sequentialId" | "name" | "party" | "countryId" | "currentOffice">
      >({ sequentialId: 1, name: 1, party: 1, countryId: 1, currentOffice: 1 })
      .limit(10)
      .toArray();

    return NextResponse.json({
      results: npps.map((n) => ({
        id: n._id.toString(),
        sequentialId: n.sequentialId ?? null,
        name: n.name,
        party: n.party,
        countryId: n.countryId ?? null,
        office: n.currentOffice ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
