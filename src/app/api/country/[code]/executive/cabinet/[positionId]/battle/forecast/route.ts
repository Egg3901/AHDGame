// GET /api/country/[code]/executive/cabinet/[positionId]/battle/forecast?theaterId=<id>&targetCountry=<CC>
// Project an offensive at a conflict against a specific enemy nation, using the SAME
// math the turn resolver will use (battleForecast) against the target's REAL units.
// Fog: returns odds BOTH ways + own strength/supply + a coarse enemy band — never the
// enemy roster. The counter-projection is derived from sides already built here.
// Auth: mirrors the declare route (the theater commander where one is designated,
// otherwise the defense holder; admin always). Gated by conflictsEnabled + defense seat.
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { authorizeBattleAction, canActAtTheater } from "@/lib/api/battleAuthz";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getConflict } from "@/lib/db/collections/conflicts";
import { conflictToFront } from "@/lib/military/createConflict";
import { buildCoalitionSide } from "@/lib/military/battleSides";
import { defendersAtFront } from "@/lib/military/coalition";
import { listPendingDeclarations } from "@/lib/db/collections/battleDeclarations";
import { battleForecast } from "@/lib/military/battle";
import { enemyBand } from "@/lib/military/forecastFog";
import { sideOf } from "@/lib/military/occupation";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { belligerentSideOf } from "@/lib/military/conflictVisibility";
import type { Front } from "@/lib/military/combat";

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const ctx = await authorizeBattleAction(params);
    if (ctx.error) return ctx.error;
    const { db, countryId, characterId, isHolder, isAdmin } = ctx;

    const url = new URL(request.url);
    const theaterId = url.searchParams.get("theaterId") ?? "";
    const targetCountry = (url.searchParams.get("targetCountry") ?? "").toUpperCase() as CountryId;

    // The conflict must be live — the same requirement as declaring here.
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
    // The same gate the declare route applies, resolved from THIS conflict's rosters
    // rather than a global bloc table — a projection must be refused exactly when the
    // offensive it projects would be. Declarer may use `sideOf`'s backer fallback (a
    // nation can enter an ongoing war); the target must already be a belligerent.
    //
    // The era's bloc roll is read ONCE here and reused for every `sideOf` below, so a
    // projection cannot place two countries against different rolls.
    const blocs = await loadMilitaryBlocs(db);
    const ownSide = sideOf(conflict, countryId, blocs);
    if (!ownSide) {
      return NextResponse.json(
        { error: "Your nation has no side in this conflict" },
        { status: 400 }
      );
    }
    const enemySide = belligerentSideOf(conflict, targetCountry);
    if (!enemySide) {
      return NextResponse.json(
        { error: "Target is not a belligerent in this conflict" },
        { status: 400 }
      );
    }
    if (enemySide === ownSide) {
      return NextResponse.json({ error: "Target is on your own side" }, { status: 400 });
    }

    const fronts: Record<string, Front> = { [theaterId]: conflictToFront(conflict) };
    const unitsCol = getMilitaryUnitsCollection(db);
    const gs = await getGameState();
    const currentTurn = gs?.currentTurn ?? 1;
    // The whole front in one query — the projection needs every belligerent's units,
    // not just the viewer's and the target's, because the defence pools allies.
    // Units still under construction (readyAtTurn not yet reached) are excluded.
    const atFront = (await unitsCol.find({ theaterId }).toArray()).filter(
      (u) => u.readyAtTurn == null || u.readyAtTurn <= currentTurn
    );
    const unitsByCountry = new Map<string, typeof atFront>();
    for (const u of atFront) {
      const list = unitsByCountry.get(u.countryId) ?? [];
      list.push(u);
      unitsByCountry.set(u.countryId, list);
    }

    // Project on the same per-side supply the resolver will use, so a forecast can
    // never disagree with the outcome it predicts. `ownSide` / `enemySide` are the ones
    // the gate above already settled — re-deriving them here once let the sides the
    // projection was built from drift from the sides it was allowed on.
    const supplyFor = (side: "A" | "B") => (side === "A" ? conflict.supplyA : conflict.supplyB);

    // Attackers are the viewer plus every ally that has already filed against this
    // front on the same side — an offensive only pools allies who declared.
    //
    // Deliberately NOT filtered by the resolver's turn window: a declaration made
    // this turn resolves alongside the viewer's, so it belongs in the projection.
    const pending = await listPendingDeclarations(db);
    const alliedDeclarers = [
      ...new Set(
        pending
          .filter((d) => d.theaterId === theaterId && d.declarerCountry !== countryId)
          .filter((d) => sideOf(conflict, d.declarerCountry, blocs) === ownSide)
          .map((d) => d.declarerCountry)
      ),
    ];
    const attackerCountries = [countryId, ...alliedDeclarers];
    const defenderCountries = defendersAtFront(conflict, atFront, theaterId, enemySide, blocs);

    const [attackerSides, defenderSides] = await Promise.all([
      buildCoalitionSide(
        db,
        attackerCountries,
        unitsByCountry,
        fronts,
        supplyFor(ownSide),
        ownSide
      ),
      buildCoalitionSide(
        db,
        defenderCountries,
        unitsByCountry,
        fronts,
        supplyFor(enemySide),
        enemySide
      ),
    ]);
    const fc = battleForecast(attackerSides, defenderSides, theaterId);
    // The same front from the other end. Derived from the sides already built here,
    // so it discloses nothing new — and it is NOT 100 − oddsPct, because the
    // defender holds terrain in whichever direction the attack runs.
    const counter = battleForecast(defenderSides, attackerSides, theaterId);
    // An undefended front fizzles at resolution rather than fighting — say so up front.
    const unopposed = defenderCountries.length === 0;
    const sup = fc.attackerProfile.sup;

    return NextResponse.json({
      oddsPct: fc.oddsPct,
      counterOddsPct: counter.oddsPct,
      ownStrength: Math.round(fc.attStr),
      supply: { level: sup.level, state: sup.state },
      enemyBand: enemyBand(fc.attStr, fc.defStr, { unopposed }),
      unopposed,
      /** How many nations the projection pooled on each side, for the war room. */
      alliedContingents: attackerSides.length,
      enemyContingents: defenderSides.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
