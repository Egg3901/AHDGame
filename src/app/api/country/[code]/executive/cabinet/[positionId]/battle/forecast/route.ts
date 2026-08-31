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
import { resolveDefendingSides } from "@/lib/military/defendingSides";
import { buildFactionSide } from "@/lib/military/factionSide";
import { listPendingDeclarations } from "@/lib/db/collections/battleDeclarations";
import { listTheaterStates } from "@/lib/db/collections/theaterState";
import { autoJoinersAtFront } from "@/lib/military/coalition";
import { battleForecast } from "@/lib/military/battle";
import { frontSupportFor } from "@/lib/navair/frontSupport";
import { loadNavairChannels } from "@/lib/db/collections/navairChannels";
import type { NavairUnit } from "@/lib/navair/types";
import { enemyBand } from "@/lib/military/forecastFog";
import { sideOf } from "@/lib/military/occupation";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { belligerentSideOf } from "@/lib/military/conflictVisibility";
import { isFactionEntity } from "@/lib/military/factionEntity";
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
    // A WorldEntityId, not a CountryId — see the faction note below.
    const targetCountry = (url.searchParams.get("targetCountry") ?? "").toUpperCase();

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
    // A forecast must be refused exactly when the offensive it projects would be, so
    // this mirrors the declare route: in a proxy war the enemy is a FACTION with no
    // COUNTRY_CONFIGS row, and the roster check below is the real gate.
    if (!isFactionEntity(conflict, targetCountry) && !COUNTRY_CONFIGS[targetCountry as CountryId]) {
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
    // front on the same side, and then the standing-order joiners below.
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
    // ...and every ally standing here under a standing order to join offensives.
    //
    // `battleResolution` folds these into `off.attackers` before it builds the sides,
    // so leaving them out here understated an offensive by exactly the allies who were
    // going to fight in it. The route's own contract is that a forecast can never
    // disagree with the outcome it predicts, so it has to ask the same question with
    // the same helper the resolver uses.
    const optedIn = new Set(
      (await listTheaterStates(db))
        .filter((st) => st.autoJoin?.[theaterId])
        .map((st) => String(st.countryId))
    );
    const autoJoiners = optedIn.size
      ? autoJoinersAtFront(conflict, atFront, theaterId, ownSide, blocs, optedIn)
      : [];
    // The viewer leads, as they do in the resolver's roster. A Set because an ally can
    // both hold a standing order and have filed a declaration of their own.
    const attackerCountries = [...new Set<string>([countryId, ...alliedDeclarers, ...autoJoiners])];
    // The same helper the resolver uses. A forecast can never disagree with the
    // outcome it predicts, and a proxy war's faction defends with a token force that
    // owns no unit rows — computing "is anyone home" a second way here is exactly how
    // the two come apart.
    const defending = resolveDefendingSides({
      conflict,
      atFront,
      theaterId,
      enemySide,
      blocs,
    });
    const defenderCountries = defending.defenderCountries;
    // Who holds this front for the VIEWER'S side, for the counter-projection below.
    //
    // Not the same roster as `attackerCountries`, and that is the whole point.
    // Attacking is opt-in: it takes a declaration or a standing order, so the attack
    // roster is only the allies who chose one. Defence is not a decision at all —
    // `defendersAtFront` enrols every belligerent with troops here, because an enemy
    // attacking the ground your troops stand on does not ask first. Projecting the
    // enemy's offensive against the ATTACK roster billed the viewer for holding the
    // front alone while allies who had opted into neither stood in the line beside
    // them, which is why "They attack" read far higher than the battle the resolver
    // would actually fight.
    const ownDefence = resolveDefendingSides({
      conflict,
      atFront,
      theaterId,
      enemySide: ownSide,
      blocs,
    });

    // The attack roster and the home defence roster are both on `ownSide`, so they take
    // the same supply and the same side flag and differ only in WHO is listed. Built as
    // one union and then partitioned: `buildBattleSide` issues three database reads per
    // country (formations, doctrine, generals), and the two rosters overlap almost
    // entirely, so building them separately paid for the viewer's own coalition twice
    // on a route the war room re-fetches every time the target changes.
    const ownRoster = [...new Set<string>([...attackerCountries, ...ownDefence.defenderCountries])];
    const [ownSides, defenderSides, navairChannels, navairUnits] = await Promise.all([
      buildCoalitionSide(db, ownRoster, unitsByCountry, fronts, supplyFor(ownSide), ownSide),
      buildCoalitionSide(
        db,
        defenderCountries,
        unitsByCountry,
        fronts,
        supplyFor(enemySide),
        enemySide
      ),
      // The naval and air layer, read the same way `battleResolution` reads it: the
      // persisted channel state `navairOperations` wrote this turn, and every naval and
      // air formation wherever it stands — reach from station is frontSupportFor's job.
      loadNavairChannels(db),
      unitsCol.find({ domain: { $in: ["naval", "air"] } }).toArray() as unknown as Promise<
        NavairUnit[]
      >,
    ]);
    const ownByCountry = new Map(ownSides.map((s) => [s.country, s]));
    // `filter(Boolean)` is not enough for the type narrowing, and a miss would be a
    // logic error rather than a data condition — every name in both rosters was just
    // used to build `ownSides`.
    const pickOwn = (countries: string[]) =>
      countries.map((c) => ownByCountry.get(c)).filter((s) => s !== undefined);
    const attackerSides = pickOwn(attackerCountries);
    const ownDefenderSides = pickOwn(ownDefence.defenderCountries);
    // The projection has to include the token force for the same reason the battle
    // does — otherwise it forecasts an unopposed advance the resolver will not deliver.
    const factionSide = defending.factionDefends
      ? buildFactionSide(conflict, defending.factionDefends, fronts[theaterId]!)
      : null;
    if (factionSide && factionSide.units.length > 0) {
      factionSide.conflictSupply = supplyFor(enemySide);
      defenderSides.push(factionSide);
    }
    // The viewer's side can be a proxy war's faction too — same reason, other end.
    const ownFactionSide = ownDefence.factionDefends
      ? buildFactionSide(conflict, ownDefence.factionDefends, fronts[theaterId]!)
      : null;
    if (ownFactionSide && ownFactionSide.units.length > 0) {
      ownFactionSide.conflictSupply = supplyFor(ownSide);
      ownDefenderSides.push(ownFactionSide);
    }

    // What the naval and air layer delivers to each roster at this front, computed with
    // the resolver's own helper so the projection carries the same air superiority,
    // close air support and interdiction the battle will be fought under. Omitting
    // these was the bug: both sides projected at NO_SUPPORT, so the displayed odds and
    // supply never moved when air deployed, while the resolver's battle did.
    const frontRegion = conflict.region;
    const supportFor = (sides: { country: string }[]) =>
      frontSupportFor(
        navairUnits,
        navairChannels,
        sides.map((s) => s.country),
        frontRegion
      );
    const supportAttack = supportFor(attackerSides);
    const supportEnemy = supportFor(defenderSides);
    const supportOwnDefence = supportFor(ownDefenderSides);

    const fc = battleForecast(attackerSides, defenderSides, theaterId, supportAttack, supportEnemy);
    // The same front from the other end. Derived from the sides already built here,
    // so it discloses nothing new — and it is NOT 100 − oddsPct, because the
    // defender holds terrain in whichever direction the attack runs.
    //
    // Both rosters change when the attack does. The enemy attacks with everything
    // they hold here — they have a full turn to declare, so their present force is
    // what they could bring — and the viewer meets it with `ownDefenderSides`, the
    // allies who are already standing on this ground, not the ones who happened to
    // file an offensive alongside them.
    const counter = battleForecast(
      defenderSides,
      ownDefenderSides,
      theaterId,
      supportEnemy,
      supportOwnDefence
    );
    // An undefended front fizzles at resolution rather than fighting — say so up front.
    const unopposed = defending.unopposed;
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
