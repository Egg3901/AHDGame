import { NextResponse } from "next/server";
import { z } from "zod";
import { isTargetValidForCountry } from "@/lib/demographics/turnoutTargets";
import { requireHumanSessionWithCharacter, requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { deliverAddress } from "@/lib/governorOffice/address/deliverAddress";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { getDemographicCategoriesForCountry } from "@/lib/demographics/countryDemographics";
import {
  ADDRESS_COOLDOWN_TURNS,
  ADDRESS_EMPHASIS_MIN,
  ADDRESS_EMPHASIS_MAX,
  ADDRESS_TITLE_MIN_LENGTH,
  ADDRESS_TITLE_MAX_LENGTH,
  ADDRESS_BODY_MAX_LENGTH,
} from "@/lib/constants/governorOffice";
import type { Character, GameState, GovernorAddress, GovernorOfficeState } from "@/lib/db/types";

/**
 * National (head-of-government) addresses — country leader's equivalent of
 * a Governor's State of the State. Operates on the same `governorAddresses`
 * collection with `stateId = getNationalStateId(countryId)`.
 */

// POST /api/country/[code]/executive/address — deliver a national address.
// Auth: requireHumanSessionWithCharacter; must be the sitting leader or admin.
// Errors: 400, 401, 403
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

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

    const db = await getDb();

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
    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader && !adminOverride) {
      return NextResponse.json(
        { error: "Only the sitting leader can deliver a national address" },
        { status: 403 }
      );
    }

    const result = await deliverAddress(db, {
      countryId,
      stateId: getNationalStateId(countryId),
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

// GET /api/country/[code]/executive/address — page-load payload for the
// Address tab. Returns most-recent address, cooldown, AP / NPI balances,
// and the country's demographic groups for the modal dropdown.
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const stateId = getNationalStateId(countryId);
    const characterId = auth.user.character?._id;
    const isAdmin = auth.user.isAdmin === true;
    const viewerIsLeader = characterId ? await isSittingLeader(db, countryId, characterId) : false;

    const [office, recentArr, gameStateDoc, charDoc] = await Promise.all([
      db.collection<GovernorOfficeState>("governorOfficeState").findOne({ countryId, stateId }),
      db
        .collection<GovernorAddress>("governorAddresses")
        .find({ countryId, stateId })
        .sort({ deliveredAtTurn: -1 })
        .limit(1)
        .toArray(),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      characterId
        ? db.collection<Character>("characters").findOne({ _id: characterId })
        : Promise.resolve(null),
    ]);

    const currentTurn = gameStateDoc?.currentTurn ?? 0;
    const last = recentArr[0] ?? null;
    const addressAvailableAtTurn = last
      ? last.deliveredAtTurn + ADDRESS_COOLDOWN_TURNS
      : currentTurn;

    const mostRecentAddress = last
      ? {
          deliveredAtTurn: last.deliveredAtTurn,
          deliveredByName: last.deliveredByName,
          title: last.title ?? null,
          body: last.body ?? null,
          emphasizedCategories: last.emphasizedCategories ?? [],
          targetDemographicGroupId: last.targetDemographicGroupId ?? null,
          approvalEffect: last.approvalEffect,
          agendaEffect: last.agendaEffect ?? null,
          demographicEffect: last.demographicEffect ?? null,
        }
      : null;

    return NextResponse.json({
      countryId,
      stateId,
      currentTurn,
      gubernatorialActions: office?.gubernatorialActions ?? 0,
      lastActionGrantedTurn: office?.lastActionGrantedTurn ?? 0,
      nationalInfluence: charDoc?.nationalInfluence ?? 0,
      viewerIsLeader,
      viewerIsAdmin: isAdmin,
      mostRecentAddress,
      addressAvailableAtTurn,
      demographicGroups: getDemographicCategoriesForCountry(countryId).flatMap((c) =>
        c.groups.map((g) => ({ id: g.id, name: g.name }))
      ),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
