import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryReferendums } from "@/lib/publicApi/referendums";
import { parseBoundedInt } from "@/lib/publicApi/params";
import { publicError } from "@/lib/publicApi/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ReferendumStatus } from "@/lib/db/types/referendum";

const STATUSES = new Set<ReferendumStatus>([
  "requested",
  "declined",
  "granted",
  "campaigning",
  "polling",
  "actuating",
  "completed",
  "settled",
  "cancelled",
]);

// GET /api/public/v1/referendums?country=CODE&status=STATUS&limit=N
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "referendums");
    if (!guard.ok) return guard.response;
    const search = new URL(request.url).searchParams;
    const country = search.get("country")?.toUpperCase() as CountryId | undefined;
    if (country && !COUNTRY_CONFIGS[country]) {
      return publicError("INVALID_COUNTRY", "Invalid country code", 400);
    }
    const status = search.get("status") as ReferendumStatus | null;
    if (status && !STATUSES.has(status)) {
      return publicError("BAD_REQUEST", "Invalid referendum status", 400);
    }
    const limit = parseBoundedInt(search.get("limit"), {
      name: "limit",
      defaultValue: 50,
      min: 1,
      max: 200,
    });
    if (!limit.ok) return publicError("BAD_REQUEST", limit.message, 400);
    const result = await queryReferendums(await getDb(), {
      country,
      status: status ?? undefined,
      limit: limit.value,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
