import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation, Tariff } from "@/lib/db/types";

// GET /api/world/trade/tariffs - List every active tariff (rate > 0) across all
// nations, shaped for the World Trade "Trade Restrictions" view. Read-only: the
// tariffs collection is reconciled from signed bills every turn (buildCorporationLookups),
// so this surface reads it directly rather than re-reconciling on each page load.
// Auth: none
// Errors: 500
export async function GET() {
  try {
    const db = await getDb();

    const tariffs = await db
      .collection<Tariff>("tariffs")
      .find({ rate: { $gt: 0 } })
      .sort({ countryId: 1, scopeType: 1, createdAt: 1 })
      .toArray();

    // Resolve corporation-scoped targets to names in one pass so the world view
    // never shows a bare ObjectId.
    const corpIds = [
      ...new Set(
        tariffs
          .filter((t) => t.scopeType === "corporation" && t.targetCorporationId)
          .map((t) => t.targetCorporationId!.toString())
      ),
    ];
    const corpNameById = new Map<string, string>();
    if (corpIds.length > 0) {
      const corps = await db
        .collection<Corporation>("corporations")
        .find({ _id: { $in: corpIds.map((id) => new ObjectId(id)) } }, { projection: { name: 1 } })
        .toArray();
      for (const c of corps) corpNameById.set(c._id.toString(), c.name);
    }

    const items = tariffs.map((t) => {
      const corpId = t.targetCorporationId?.toString() ?? null;
      return {
        id: t._id.toString(),
        countryId: t.countryId,
        scopeType: t.scopeType,
        targetSectorType: t.targetSectorType ?? null,
        targetOriginCountryId: t.targetOriginCountryId ?? null,
        targetCorporationName: corpId ? (corpNameById.get(corpId) ?? null) : null,
        rate: t.rate,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return handleRouteError(error);
  }
}
