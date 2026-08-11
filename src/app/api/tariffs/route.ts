/**
 * GET /api/tariffs?countryId=US — Returns all active tariffs for a country.
 * Public read endpoint for the legislature tariffs tab and corporation trade restrictions panel.
 * Auth: public
 * Errors: 400
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Tariff } from "@/lib/db/types";
import { ALL_COUNTRY_IDS, type CountryId } from "@/lib/constants/countries";
import { reconcileSignedTariffBills } from "@/lib/tariffs/reconcileTariffs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get("countryId");
    if (!raw || !(ALL_COUNTRY_IDS as readonly string[]).includes(raw)) {
      return NextResponse.json({ error: "Invalid or missing countryId" }, { status: 400 });
    }
    const countryId = raw as CountryId;

    const db = await getDb();
    await reconcileSignedTariffBills(db, countryId);
    const tariffs = await db
      .collection<Tariff>("tariffs")
      .find({ countryId })
      .sort({ scopeType: 1, createdAt: 1 })
      .toArray();

    return NextResponse.json({
      tariffs: tariffs.map((t) => ({
        id: t._id.toString(),
        countryId: t.countryId,
        scopeType: t.scopeType,
        targetSectorType: t.targetSectorType ?? null,
        targetOriginCountryId: t.targetOriginCountryId ?? null,
        targetCorporationId: t.targetCorporationId?.toString() ?? null,
        rate: t.rate,
        sourceBillId: t.sourceBillId.toString(),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
