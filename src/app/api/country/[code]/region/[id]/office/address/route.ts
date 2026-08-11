import { NextResponse } from "next/server";
import { z } from "zod";
import { isTargetValidForCountry } from "@/lib/demographics/turnoutTargets";
import { requireHumanSessionWithCharacter, requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getOfficeHolderRow } from "@/lib/governorOffice/queries";
import { deliverAddress } from "@/lib/governorOffice/address/deliverAddress";
import {
  ADDRESS_COOLDOWN_TURNS,
  ADDRESS_EMPHASIS_MIN,
  ADDRESS_EMPHASIS_MAX,
  ADDRESS_TITLE_MIN_LENGTH,
  ADDRESS_TITLE_MAX_LENGTH,
  ADDRESS_BODY_MAX_LENGTH,
} from "@/lib/constants/governorOffice";
import type { GameState } from "@/lib/db/types";

// POST /api/country/[code]/region/[id]/office/address — Deliver a State of the State address.
// Auth: requireHumanSessionWithCharacter; must be the office-holder.
// Errors: 400, 401, 403
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();

    const parsed = await parseJsonBody(
      request,
      z.object({
        title: z.string().min(ADDRESS_TITLE_MIN_LENGTH).max(ADDRESS_TITLE_MAX_LENGTH),
        body: z.string().max(ADDRESS_BODY_MAX_LENGTH).optional(),
        emphasizedCategories: z
          .array(z.string().min(1))
          .min(ADDRESS_EMPHASIS_MIN)
          .max(ADDRESS_EMPHASIS_MAX),
        targetDemographicGroupId: z.string().min(1).optional(),
        adminOverride: z.boolean().optional(),
      })
    );
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    // The target must be a bucket THIS country's electorate actually has.
    // Validated here rather than in the schema because the valid set depends on
    // the game's preset. A stale or foreign bucket used to be accepted, charged,
    // and then applied to no voters at all.
    const targetId = parsed.data.targetDemographicGroupId;
    if (targetId) {
      const gs = await db
        .collection<{ _id: string; preset?: string }>("gameState")
        .findOne({ _id: "current" }, { projection: { preset: 1 } });
      if (!isTargetValidForCountry(targetId, countryId, gs?.preset ?? null)) {
        return NextResponse.json({ error: "Unknown demographic target" }, { status: 400 });
      }
    }

    const isAdmin = auth.user.isAdmin === true;
    const adminOverride = parsed.data.adminOverride === true && isAdmin;
    if (!adminOverride) {
      const holder = await getOfficeHolderRow(db, countryId, stateId, auth.user.character._id);
      if (!holder) return NextResponse.json({ error: "Not the office-holder" }, { status: 403 });
    }

    const result = await deliverAddress(db, {
      countryId,
      stateId,
      character: auth.user.character,
      title: parsed.data.title,
      body: parsed.data.body,
      emphasizedCategories: parsed.data.emphasizedCategories,
      targetDemographicGroupId: parsed.data.targetDemographicGroupId,
      adminOverride,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/country/[code]/region/[id]/office/address — cooldown + most recent.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const recent = await db
      .collection("governorAddresses")
      .find({ countryId, stateId })
      .sort({ deliveredAtTurn: -1 })
      .limit(1)
      .toArray();
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;
    const last = recent[0] ?? null;
    return NextResponse.json({
      mostRecent: last,
      lastDeliveredAtTurn: last?.deliveredAtTurn ?? null,
      availableAtTurn: last ? last.deliveredAtTurn + ADDRESS_COOLDOWN_TURNS : currentTurn,
      currentTurn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
