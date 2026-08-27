// PUT /api/country/[code]/executive/cabinet/[positionId]/battle/auto-join
// Set whether this nation joins an ally's offensive at a theater without declaring one
// of its own. A standing order, not an action: it changes what the next tick does with
// an ally's declaration, and nothing about this turn.
// Auth: mirrors the declare route exactly, because the same people who can order an
// attack here are the ones who may standing-order one.
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { authorizeBattleAction, canActAtTheater } from "@/lib/api/battleAuthz";
import { getConflict } from "@/lib/db/collections/conflicts";
import { getTheaterStateCollection } from "@/lib/db/collections/theaterState";
import { sideOf } from "@/lib/military/occupation";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import type { CountryId } from "@/lib/constants/countries";

const bodySchema = z.object({ theaterId: z.string(), enabled: z.boolean() });

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const ctx = await authorizeBattleAction(params);
    if (ctx.error) return ctx.error;
    const { db, countryId, characterId, isHolder, isAdmin } = ctx;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { theaterId, enabled } = parsed.data;

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

    // A nation with no side has no allies here, so the order could never fire. Refusing
    // is better than storing a flag that silently does nothing forever.
    const blocs = await loadMilitaryBlocs(db);
    if (!sideOf(conflict, countryId, blocs)) {
      return NextResponse.json(
        { error: "Your nation has no side in this conflict" },
        { status: 400 }
      );
    }

    await getTheaterStateCollection(db).updateOne(
      { countryId: countryId as CountryId },
      {
        // `$set` on the nested key, never on the whole `autoJoin` object: a country can
        // hold standing orders at several fronts and writing the map wholesale would
        // drop the others.
        $set: { [`autoJoin.${theaterId}`]: enabled },
        // A country that has never had theatre state yet still needs the defaults the
        // reader assumes, or `cohesion` comes back undefined on the next read.
        $setOnInsert: { cohesion: 85, committed: {} },
      },
      { upsert: true }
    );

    return NextResponse.json({ theaterId, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
