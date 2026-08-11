import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";

// GET /api/public/v1/market?type=SECTOR&country=CODE&page=N&view=share|unowned
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "market");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const country = url.searchParams.get("country") ?? undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const view = url.searchParams.get("view") ?? "share";

    if (!type) {
      return NextResponse.json(
        { ok: false, error: "type is required", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const query: Record<string, unknown> = { sectorType: type };
    if (country) query.countryId = country;

    if (view === "unowned") {
      const [sectors, total] = await Promise.all([
        db
          .collection("unownedSectors")
          .find(query)
          .skip((page - 1) * 20)
          .limit(20)
          .toArray(),
        db.collection("unownedSectors").countDocuments(query),
      ]);
      return NextResponse.json({
        ok: true,
        found: sectors.length > 0,
        mode: "unowned",
        sectorType: type,
        page,
        totalPages: Math.ceil(total / 20),
        totalItems: total,
        sectors,
      }, { headers: guard.headers });
    }

    const [companies, total] = await Promise.all([
      db
        .collection("corporateSectors")
        .find(query)
        .skip((page - 1) * 20)
        .limit(20)
        .toArray(),
      db.collection("corporateSectors").countDocuments(query),
    ]);
    return NextResponse.json({
      ok: true,
      found: companies.length > 0,
      mode: "share",
      sectorType: type,
      page,
      totalPages: Math.ceil(total / 20),
      totalItems: total,
      companies,
    }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
