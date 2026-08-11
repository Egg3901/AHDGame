// POST   /api/country/[code]/executive/cabinet/[positionId]/battle/declare
// DELETE /api/country/[code]/executive/cabinet/[positionId]/battle/declare?theaterId=<id>
// Declare (or withdraw) an offensive at a theater against a specific enemy nation.
// Resolves on the next turn tick. Auth: the theater commander where one is designated,
// otherwise the defense holder; admin always. Gated by conflictsEnabled + defense seat.
// Errors: 400, 401, 403, 404, 409.
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { authorizeBattleAction, canActAtTheater } from "@/lib/api/battleAuthz";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import {
  getBattleDeclarationsCollection,
  getPendingDeclaration,
} from "@/lib/db/collections/battleDeclarations";
import { belligerentSideOf } from "@/lib/military/conflictVisibility";
import { sideOf } from "@/lib/military/occupation";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { getConflict } from "@/lib/db/collections/conflicts";

const declareSchema = z.object({ theaterId: z.string(), targetCountry: z.string() });

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await authorizeBattleAction(params);
    if (ctx.error) return ctx.error;
    const { db, countryId, currentTurn, characterId, isHolder, isAdmin } = ctx;

    const parsed = await parseJsonBody(request, declareSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { theaterId } = parsed.data;
    const targetCountry = parsed.data.targetCountry.toUpperCase() as CountryId;

    const conflict = await getConflict(db, theaterId);
    if (!conflict) {
      return NextResponse.json({ error: "No such conflict" }, { status: 400 });
    }
    const denied = await canActAtTheater(db, countryId, theaterId, {
      characterId,
      isHolder,
      isAdmin,
    });
    if (denied) return denied;
    if (!COUNTRY_CONFIGS[targetCountry]) {
      return NextResponse.json({ error: "Invalid target country" }, { status: 400 });
    }

    // Opposition is THIS conflict's rosters, never a global bloc table. The table this
    // replaces held 9 of 27 countries and read every missing one as western, which is
    // what stopped an East German player declaring on NATO at all.
    //
    // The two ends resolve by DIFFERENT rules on purpose. The declarer may use
    // `sideOf`'s backer fallback, so a nation in neither roster can still enter an
    // ongoing war on the side its alliance backs. The target may not: you can only
    // attack somebody already in this war, or a belligerent could drag in a bystander.
    const ownSide = sideOf(conflict, countryId, await loadMilitaryBlocs(db));
    if (!ownSide) {
      return NextResponse.json(
        { error: "Your nation has no side in this conflict" },
        { status: 400 }
      );
    }
    const targetSide = belligerentSideOf(conflict, targetCountry);
    if (!targetSide) {
      return NextResponse.json(
        { error: "Target is not a belligerent in this conflict" },
        { status: 400 }
      );
    }
    if (targetSide === ownSide) {
      return NextResponse.json({ error: "Target is on your own side" }, { status: 400 });
    }

    const forceAtTheater = await getMilitaryUnitsCollection(db).countDocuments({
      countryId,
      theaterId,
    });
    if (forceAtTheater === 0) {
      return NextResponse.json({ error: "No forces committed at this theater" }, { status: 400 });
    }

    const existing = await getPendingDeclaration(db, countryId, theaterId);
    if (existing) {
      return NextResponse.json({ error: "An offensive is already pending here" }, { status: 409 });
    }

    const doc = {
      declarerCountry: countryId,
      targetCountry,
      theaterId,
      declaredByCharacterId: characterId,
      declaredTurn: currentTurn,
      status: "pending" as const,
    };
    await getBattleDeclarationsCollection(db).insertOne(doc as never);
    return NextResponse.json({ ok: true, declaration: doc });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const ctx = await authorizeBattleAction(params);
    if (ctx.error) return ctx.error;
    const { db, countryId, characterId, isHolder, isAdmin } = ctx;

    const theaterId = new URL(request.url).searchParams.get("theaterId") ?? "";
    const denied = await canActAtTheater(db, countryId, theaterId, {
      characterId,
      isHolder,
      isAdmin,
    });
    if (denied) return denied;

    const res = await getBattleDeclarationsCollection(db).deleteOne({
      declarerCountry: countryId,
      theaterId,
      status: "pending",
    });
    if (res.deletedCount === 0) {
      return NextResponse.json({ error: "No pending offensive" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
