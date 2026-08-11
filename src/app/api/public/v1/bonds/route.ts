import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import type { Bond } from "@/lib/db/types/bond";
import type { Corporation } from "@/lib/db/types";

const PER_PAGE = 20;

// GET /api/public/v1/bonds?corp=NAME&page=N
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "bonds");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const corp = url.searchParams.get("corp") ?? undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));

    const db = await getDb();
    const query: Record<string, unknown> = { defaulted: { $ne: true } };

    if (corp) {
      const corpDoc = await db.collection<Corporation>("corporations").findOne({
        name: { $regex: escapeRegex(corp), $options: "i" },
      });
      if (corpDoc) {
        query.corporationId = corpDoc._id;
      } else {
        return NextResponse.json({
          ok: true,
          found: false,
          bonds: [],
          pagination: { page, totalCount: 0, totalPages: 0 },
        }, { headers: guard.headers });
      }
    }

    const [bonds, total] = await Promise.all([
      db
        .collection<Bond>("bonds")
        .find(query)
        .skip((page - 1) * PER_PAGE)
        .limit(PER_PAGE)
        .toArray(),
      db.collection<Bond>("bonds").countDocuments(query),
    ]);

    return NextResponse.json({
      ok: true,
      found: bonds.length > 0,
      bonds: bonds.map((b) => ({
        id: b._id.toString(),
        couponRate: b.couponRate,
        maturityLabel: (b as Record<string, unknown>).maturityLabel ?? null,
        totalIssued: b.totalIssued,
        marketPrice: b.marketPrice,
        turnsRemaining: (b as Record<string, unknown>).turnsRemaining ?? 0,
        yieldToMaturity: (b as Record<string, unknown>).yieldToMaturity ?? null,
        holders: Array.isArray(b.holders) ? b.holders.length : 0,
        defaulted: b.defaulted,
      })),
      pagination: {
        page,
        perPage: PER_PAGE,
        totalCount: total,
        totalPages: Math.ceil(total / PER_PAGE),
      },
    }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
