// POST /api/country/[code]/executive/cabinet/[positionId]/estates/open
// Auth: requireAuth — must be the seat holder or admin. Costs 1 ministerial action.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  refundMinisterialAction,
  resolveMinisterialRemaining,
  spendMinisterialAction,
} from "@/lib/cabinet/ministerialActionPool";
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";
import {
  resolveEstatePortfolio,
  getEstateArchetype,
  isAbroadSited,
} from "@/lib/constants/cabinetEstates";

const openSchema = z.object({
  archetypeId: z.string(),
  siteId: z.string().min(1),
  name: z.string().min(1).max(80),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    const portfolioKey = resolveEstatePortfolio(countryId, positionId);
    if (!portfolioKey) {
      return errorResponse(404, "Not an estates cabinet position");
    }

    const parsed = await parseJsonBody(request, openSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const archetype = getEstateArchetype(portfolioKey, parsed.data.archetypeId);
    if (!archetype) {
      return errorResponse(400, "Invalid archetype for this portfolio");
    }

    const db = await getDb();
    const isForeign = isAbroadSited(portfolioKey);
    const siteScope: "region" | "country" = isForeign ? "country" : "region";

    // Validate the site by scope.
    if (isForeign) {
      if (parsed.data.siteId === countryId) {
        return errorResponse(400, "This portfolio's estates must be sited in another country");
      }
      const enabled = await getEnabledCountryIds();
      if (!enabled.includes(parsed.data.siteId as CountryId)) {
        return errorResponse(400, "Invalid host country");
      }
    } else {
      const region = await db
        .collection<{ _id: string; countryId: string }>("states")
        .findOne({ _id: parsed.data.siteId, countryId }, { projection: { _id: 1 } });
      if (!region) {
        return errorResponse(400, "Invalid region for this country");
      }
    }

    const membersCol = getCabinetMembersCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the seat holder or admin can open estates");
    }

    // Opening an estate commits the department to running it after this tenure.
    const actingDenied = requireConfirmedSecretary(member, "assets", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    // Backfill legacy members missing the action fields (mirrors the order route).
    // Shared UK pool: both offices of a dual holder spend one balance (issue #2049).
    const actions = await resolveMinisterialRemaining(db, countryId, member!);
    if (actions < 1) {
      return errorResponse(400, "No ministerial actions remaining");
    }

    const estatesCol = getCabinetEstatesCollection(db);
    // Foreign: enforce one-of-archetype-per-host BEFORE spending the action.
    if (isForeign) {
      const dup = await estatesCol.findOne({
        countryId,
        positionId,
        archetypeId: archetype.id,
        siteScope: "country",
        siteId: parsed.data.siteId,
      });
      if (dup) {
        return errorResponse(409, "This country already hosts that installation");
      }
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const spend = await spendMinisterialAction(db, countryId, member!);
    if (!spend.ok) {
      return errorResponse(409, "No ministerial actions remaining");
    }

    try {
      await estatesCol.insertOne({
        _id: new ObjectId(),
        countryId,
        portfolioKey,
        positionId,
        archetypeId: archetype.id,
        name: parsed.data.name.trim(),
        icon: archetype.icon,
        fundingLevel: "standard",
        tier: 0,
        condition: 100,
        outputBase: archetype.outputBase,
        upkeepBase: archetype.upkeepBase,
        siteScope,
        siteId: parsed.data.siteId,
        createdTurn: currentTurn,
      });
    } catch (error) {
      await refundMinisterialAction(db, countryId, member!);
      throw error;
    }

    return NextResponse.json({ success: true, actionsRemaining: spend.remaining });
  } catch (error) {
    return handleRouteError(error);
  }
}
