// GET diagnoses NPPs whose name came from the US fallback pool rather than their own country's.
// POST renames them from the correct pool and propagates the new name to electedOfficials.
// Auth: requireAdmin
// Errors: 401, 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { planNppNameHeal, applyNppNameHeal } from "@/lib/npp/healNames";

/**
 * GET /api/admin/heal/npp-names
 * Report how many active NPPs carry a name their country's pool could not
 * have produced, broken down by country, with a sample of the renames.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const countryId = new URL(request.url).searchParams.get("countryId") ?? undefined;
    const db = await getDb();
    const { scanned, renames, unresolved } = await planNppNameHeal(db, { countryId });

    const byCountry: Record<string, number> = {};
    for (const rename of renames) {
      byCountry[rename.countryId] = (byCountry[rename.countryId] ?? 0) + 1;
    }

    return NextResponse.json({
      status: renames.length === 0 ? "ok" : "issues_found",
      message:
        renames.length === 0
          ? `All ${scanned} active NPPs are named from their own country's pool.`
          : `${renames.length} of ${scanned} active NPPs carry a name from the US fallback pool.`,
      scanned,
      needsRename: renames.length,
      unresolved,
      byCountry,
      sample: renames.slice(0, 20).map(({ countryId: country, oldName, newName }) => ({
        countryId: country,
        oldName,
        newName,
      })),
    });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/admin/heal/npp-names" });
  }
}

/**
 * POST /api/admin/heal/npp-names
 * Rename the affected NPPs. Accepts an optional `countryId` to heal one
 * country at a time, and `limit` to cap how many are renamed in one call.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const countryId = url.searchParams.get("countryId") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      return NextResponse.json({ error: "limit must be a positive number" }, { status: 400 });
    }

    const db = await getDb();
    const { scanned, renames, unresolved } = await planNppNameHeal(db, { countryId, limit });
    const { renamed, officialsUpdated, candidaciesUpdated } = await applyNppNameHeal(db, renames);

    const messages = [
      renamed > 0
        ? `Renamed ${renamed} NPPs from their own country's name pool`
        : "No NPPs needed renaming",
    ];
    if (officialsUpdated > 0) {
      messages.push(`Updated ${officialsUpdated} elected-official name snapshots`);
    }
    if (candidaciesUpdated > 0) {
      messages.push(`Updated ${candidaciesUpdated} election-candidate name snapshots`);
    }
    if (unresolved > 0) {
      messages.push(`${unresolved} skipped (pool could not produce an unused name)`);
    }

    return NextResponse.json({
      status: "ok",
      message: messages.join(". "),
      scanned,
      renamed,
      officialsUpdated,
      candidaciesUpdated,
      unresolved,
    });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/admin/heal/npp-names" });
  }
}
