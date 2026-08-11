/**
 * GET    /api/admin/tariffs?countryId=US — List all tariffs for a country.
 * POST   /api/admin/tariffs — Force-set a tariff (bypass legislation).
 * DELETE /api/admin/tariffs?id=<tariffId> — Remove a tariff document.
 * Auth: requireAdmin
 * Errors: 400, 401, 403
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Tariff } from "@/lib/db/types";
import { ZOD_COUNTRY_ENUM, type CountryId } from "@/lib/constants/countries";

const upsertSchema = z.object({
  countryId: z.enum(ZOD_COUNTRY_ENUM),
  scopeType: z.enum(["economy_wide", "sector", "origin_country", "corporation"]),
  targetSectorType: z.string().optional(),
  targetOriginCountryId: z.enum(ZOD_COUNTRY_ENUM).optional(),
  targetCorporationId: z.string().optional(),
  rate: z.number().min(0).max(100),
});

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const countryId = searchParams.get("countryId") as CountryId | null;
    if (!countryId) throw badRequest("countryId required");

    const db = await getDb();
    const tariffs = await db.collection<Tariff>("tariffs").find({ countryId }).toArray();
    return NextResponse.json({ tariffs });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, upsertSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const {
      countryId,
      scopeType,
      targetSectorType,
      targetOriginCountryId,
      targetCorporationId,
      rate,
    } = parsed.data;
    const db = await getDb();
    const now = new Date();

    const adminBillId = new ObjectId(); // sentinel for admin-set tariffs
    const filter: Record<string, unknown> = {
      countryId,
      scopeType,
      targetSectorType: targetSectorType ?? null,
      targetOriginCountryId: targetOriginCountryId ?? null,
      targetCorporationId: targetCorporationId ? new ObjectId(targetCorporationId) : null,
    };

    await db.collection<Tariff>("tariffs").updateOne(
      filter,
      {
        $set: { rate, sourceBillId: adminBillId, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id || id.length !== 24) throw badRequest("Valid tariff id required");

    const db = await getDb();
    const result = await db.collection<Tariff>("tariffs").deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) throw notFound("Tariff not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
