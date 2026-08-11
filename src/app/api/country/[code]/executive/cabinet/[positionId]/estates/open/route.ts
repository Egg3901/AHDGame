// POST /api/country/[code]/executive/cabinet/[positionId]/estates/open
// Auth: requireAuth — must be the seat holder or admin. Costs 1 ministerial action.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
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
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const portfolioKey = resolveEstatePortfolio(countryId, positionId);
    if (!portfolioKey) {
      return NextResponse.json({ error: "Not an estates cabinet position" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, openSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const archetype = getEstateArchetype(portfolioKey, parsed.data.archetypeId);
    if (!archetype) {
      return NextResponse.json({ error: "Invalid archetype for this portfolio" }, { status: 400 });
    }

    const db = await getDb();
    const isForeign = isAbroadSited(portfolioKey);
    const siteScope: "region" | "country" = isForeign ? "country" : "region";

    // Validate the site by scope.
    if (isForeign) {
      if (parsed.data.siteId === countryId) {
        return NextResponse.json(
          { error: "This portfolio's estates must be sited in another country" },
          { status: 400 }
        );
      }
      const enabled = await getEnabledCountryIds();
      if (!enabled.includes(parsed.data.siteId as CountryId)) {
        return NextResponse.json({ error: "Invalid host country" }, { status: 400 });
      }
    } else {
      const region = await db
        .collection<{ _id: string; countryId: string }>("states")
        .findOne({ _id: parsed.data.siteId, countryId }, { projection: { _id: 1 } });
      if (!region) {
        return NextResponse.json({ error: "Invalid region for this country" }, { status: 400 });
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
      return NextResponse.json(
        { error: "Only the seat holder or admin can open estates" },
        { status: 403 }
      );
    }

    // Backfill legacy members missing the action fields (mirrors the order route).
    if (member && member.ministerialActions == null) {
      await membersCol.updateOne({ _id: member._id }, { $set: { ministerialActions: 2 } });
      member.ministerialActions = 2;
    }
    const actions = member?.ministerialActions ?? 2;
    if (actions < 1) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 400 });
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
        return NextResponse.json(
          { error: "This country already hosts that installation" },
          { status: 409 }
        );
      }
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const spend = await membersCol.updateOne(
      { _id: member!._id, ministerialActions: { $gte: 1 } },
      { $inc: { ministerialActions: -1 } }
    );
    if (spend.modifiedCount === 0) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 409 });
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
      await membersCol.updateOne({ _id: member!._id }, { $inc: { ministerialActions: 1 } });
      throw error;
    }

    return NextResponse.json({ success: true, actionsRemaining: actions - 1 });
  } catch (error) {
    return handleRouteError(error);
  }
}
