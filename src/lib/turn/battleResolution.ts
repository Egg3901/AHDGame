// Turn-processor step: resolve declared offensives on the tick.
// For each pending declaration made on an EARLIER turn (the defender's window),
// resolve the declarer's forces against the target's real units at the theater,
// persist per-unit outcomes to BOTH nations, record a report, and mark it resolved.
// The winner then pushes the conflict's front line toward the loser's pole; a front
// driven all the way ends the war. An unopposed offensive walks forward unopposed.
// Deterministic — seeded by declaration id + turn.
import type { Db } from "mongodb";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getCharacterGeneralsCollection } from "@/lib/db/collections/characterGenerals";
import { levelGeneral } from "@/lib/military/generals";
import {
  getBattleDeclarationsCollection,
  listPendingDeclarations,
} from "@/lib/db/collections/battleDeclarations";
import { getBattleReportsCollection } from "@/lib/db/collections/battleReports";
import type { BattleDeclarationDoc } from "@/lib/db/types/battleDeclaration";
import type { CountryId } from "@/lib/constants/countries";
import {
  applyOutcome,
  contingentsOf,
  resolvePvpBattle,
  hashStr,
  type BattleContext,
  type BattleResult,
  type BattleSide,
  type SideOutcome,
} from "@/lib/military/battle";
import { buildCoalitionSide } from "@/lib/military/battleSides";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { mergeOffensives, autoJoinersAtFront } from "@/lib/military/coalition";
import { joinSide } from "@/lib/military/joinSide";
import { isFactionEntity } from "@/lib/military/factionEntity";
import { resolveDefendingSides } from "@/lib/military/defendingSides";
import { buildFactionSide } from "@/lib/military/factionSide";
import type { Front } from "@/lib/military/combat";
import { getConflict, getConflictsCollection } from "@/lib/db/collections/conflicts";
import { conflictToFront } from "@/lib/military/createConflict";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolveConflict } from "@/lib/military/resolveConflict";
import { frontSupportFor } from "@/lib/navair/frontSupport";
import { loadNavairChannels } from "@/lib/db/collections/navairChannels";
import type { NavairUnit } from "@/lib/navair/types";
import { standDownCountry } from "@/lib/military/leaveConflict";
import { loadOffensiveOptInSources, offensiveOptInsAtFront } from "@/lib/military/offensiveOptIns";
import { principalOf, DICTATE_WINDOW_TURNS } from "@/lib/military/principal";
import { OCCUPATION } from "@/lib/military/config";
import {
  frontProgress,
  occupationShift,
  derivedSupplies,
  type Side,
} from "@/lib/military/occupation";
import { nextControlSample } from "@/lib/military/warApproval";
import { isConflictConcluded } from "@/lib/military/conflictLifecycle";

/**
 * Apply a side's outcome to its live units + the generals who led them.
 *
 * Returns the units as this battle left them, so a caller resolving more than one
 * engagement in a tick can fight the next from the survivors. The unit write is an
 * absolute `$set` of `personnel`/`readiness`/`equipment`, not an increment, so a
 * second engagement built from the pre-tick roster does not merely ignore the first
 * one's losses — it writes them back out of existence.
 */
/**
 * The faction's own dead out of a defending side's outcome.
 *
 * `SideOutcome.loss` is the whole DEFENDING SIDE's total. When a real nation defends
 * alongside the faction, charging all of it to `tokenStrength` ground the token force
 * down by its ally's casualties as well as its own — a proxy force that evaporated at
 * a rate nothing on the front could account for.
 *
 * `contingentsOf` covers the pre-coalition case on its own: those outcomes name one
 * country per side, so a side that IS the faction yields its whole loss and a side
 * that is not yields no entry for it.
 */
export function factionLoss(defender: SideOutcome, factionCountry: string): number {
  const own = contingentsOf(defender).find((c) => c.country === factionCountry);
  // No entry means the faction took no part in this engagement. Charge it nothing —
  // falling through to the side total here would bill it for its allies' dead, which
  // is the whole bug this function exists to prevent.
  return own ? Math.max(0, Math.round(own.loss)) : 0;
}

async function persistSide(
  db: Db,
  side: BattleSide,
  outcome: SideOutcome,
  sideWon: boolean
): Promise<BattleSide["units"]> {
  const ctx: BattleContext = {
    units: side.units,
    positions: side.positions,
    assignments: side.assignments,
    generalsById: side.generalsById,
    natMods: side.natMods,
    countryScale: side.countryScale,
    side: side.side,
    fronts: side.fronts,
  };
  // applyOutcome reads only `unitResults` + `win`; it returns the mutated units
  // (casualties/readiness/xp/veterancy) and the XP each general earned.
  const pseudo = { unitResults: outcome.unitResults, win: sideWon } as BattleResult;
  const { units, generalXp } = applyOutcome(ctx, pseudo);

  const fought = new Set(outcome.unitResults.map((r) => r.id));
  // Battle never rearranges the command structure: a unit keeps its general and its
  // front no matter how badly it is mauled. A hollowed-out formation is simply weak —
  // combat power scales linearly with personnel — and rebuilds in place via the
  // per-turn reinforcement flow.
  const ops = units
    .filter((u) => fought.has(String(u._id)))
    .map((u) => ({
      updateOne: {
        filter: { _id: u._id, countryId: side.country as CountryId },
        update: {
          $set: {
            personnel: u.personnel,
            readiness: u.readiness,
            // Materiel destroyed in the fighting. Without this the loss `applyOutcome`
            // computed would be discarded on write and a war would cost a nation men but
            // not a single tank — the drain the arsenal exists to be refilled against.
            equipment: u.equipment,
            xp: u.xp,
            vet: u.vet,
          },
        },
      },
    }));
  if (ops.length) await getMilitaryUnitsCollection(db).bulkWrite(ops);

  // Generals level on their own profile (characterGenerals), the single source of
  // truth for their stats. Generals who led units at this front earn, and so does the
  // Theater Commander who directed it — at a share, and whether or not they led any.
  const genOps = Object.entries(generalXp)
    .map(([characterId, xp]) => {
      const current = side.generalsById[characterId];
      if (!current) return null;
      return {
        updateOne: {
          filter: { characterId },
          update: { $set: { general: levelGeneral(current, xp) } },
        },
      };
    })
    .filter((op): op is NonNullable<typeof op> => op !== null);
  if (genOps.length) await getCharacterGeneralsCollection(db).bulkWrite(genOps);
  return units;
}

async function mark(
  db: Db,
  decl: BattleDeclarationDoc,
  status: "resolved" | "fizzled",
  resolvedTurn: number
) {
  await getBattleDeclarationsCollection(db).updateOne(
    { _id: decl._id },
    { $set: { status, resolvedTurn } }
  );
}

/** Enrol a country on the side it fought for, so later turns resolve by roster. */
/**
 * Move the front after an engagement: shift `control`, re-derive both supplies from
 * the front's displacement, track the winding-down threshold, and stand the conflict
 * down at a pole. Returns the resulting `control` (unchanged when nothing moved) and
 * whether this engagement ended the war.
 *
 * `standDown` is reported rather than read back off `conflict.status` because the
 * caller has already narrowed that field by testing it before the loop, so the
 * compiler cannot see that this function widens it again — and a cast to get around
 * that would be hiding the very mutation the caller needs to react to.
 *
 * Mutates the in-memory `conflict` with everything it writes, exactly as `joinSide`
 * does with the roster, so the rest of the tick sees a consistent document. This is
 * load-bearing, not tidiness: a tick can resolve SEVERAL offensives at one front —
 * `mergeOffensives` groups by (front, attacking side), so an attack and the enemy's
 * counter-attack are two separate offensives resolved in the same loop. Without the
 * write-back, the second one shifted from the tick's opening `control` and its write
 * overwrote the first's rather than compounding on it, so a front that was fought
 * over twice moved as if it had been fought over once.
 */
async function applyOccupation(
  db: Db,
  conflict: ConflictDoc,
  winner: Side,
  margin: number,
  loserRetreated: boolean,
  currentTurn: number
): Promise<{ control: number; standDown: boolean }> {
  const control = occupationShift({
    control: conflict.control,
    winner,
    margin,
    loserRetreated,
    turnsElapsed: currentTurn - conflict.startTurn,
  });

  // Age out the war-approval momentum sample BEFORE the no-move early return.
  // A front that stops moving must still let its sample expire, or the next
  // advance is measured against a reading from arbitrarily long ago and diluted
  // to nothing. Written on its own so the no-move path costs one small update
  // and nothing else.
  const sample = nextControlSample(conflict.controlSample, currentTurn, conflict.control);
  if (sample) {
    conflict.controlSample = sample;
    await getConflictsCollection(db).updateOne(
      { _id: conflict._id },
      { $set: { controlSample: sample } }
    );
  }

  if (control === conflict.control) return { control: conflict.control, standDown: false };

  // Pin the front's starting line and supply baselines on the first write. A conflict
  // document predating these fields would otherwise re-derive supply off its own
  // already-penalised live values, turning the derivation into an accumulation.
  const controlStart = conflict.controlStart ?? conflict.control;
  const supplyBaseA = conflict.supplyBaseA ?? conflict.supplyA;
  const supplyBaseB = conflict.supplyBaseB ?? conflict.supplyB;

  const moved = { ...conflict, control, controlStart, supplyBaseA, supplyBaseB };
  const { supplyA, supplyB } = derivedSupplies(moved);

  // A front that swings back out of the heartland returns to `active`; an escalating
  // or already-resolved conflict keeps whatever status it carries. Depth is measured
  // from the front's STARTING line — an interstate war opens with the defender
  // holding all of its own soil, which is a kickoff, not a war winding down.
  const deep = frontProgress(control, controlStart) >= OCCUPATION.deepPushDepth;
  const tracksDepth = conflict.status === "active" || conflict.status === "winding_down";
  const status = deep ? ("winding_down" as const) : ("active" as const);

  // A proxy war is not won by reaching a pole — it is won by HOLDING one. Stamp the
  // clock here and let the turn step decide; clear it the moment the front comes off
  // the pole, so a hold that is broken and re-established starts again from zero.
  const atPole = control === 0 || control === 100;
  const poleSide: Side | null = control === 0 ? "A" : control === 100 ? "B" : null;
  const isProxyWar = conflict.type === "cold_war";
  const poleFields: Partial<Pick<ConflictDoc, "poleSide" | "poleSinceTurn">> =
    isProxyWar && atPole
      ? // Re-stamp only on ARRIVAL. Rewriting `poleSinceTurn` every time a battle
        // nudges an already-pinned front would reset the clock on every engagement and
        // the three turns would never elapse.
        conflict.poleSide === poleSide
        ? {}
        : { poleSide, poleSinceTurn: currentTurn }
      : isProxyWar
        ? { poleSide: null, poleSinceTurn: null }
        : {};

  await getConflictsCollection(db).updateOne(
    { _id: conflict._id },
    {
      $set: {
        control,
        controlStart,
        supplyA,
        supplyB,
        supplyBaseA,
        supplyBaseB,
        ...(tracksDepth && { status }),
        ...poleFields,
      },
    }
  );

  // Carry the write back onto the in-memory document. `controlStart` and the supply
  // baselines are included deliberately: they are pinned with `?? conflict.control`
  // / `?? conflict.supplyX`, so a second offensive reading them still unset would
  // re-pin the starting line to the ground the FIRST offensive had just taken.
  //
  // Field by field rather than `Object.assign` with a literal: that helper's `U` is
  // unconstrained, so a mistyped key or a wrong value type would compile silently.
  conflict.control = control;
  conflict.controlStart = controlStart;
  conflict.supplyA = supplyA;
  conflict.supplyB = supplyB;
  conflict.supplyBaseA = supplyBaseA;
  conflict.supplyBaseB = supplyBaseB;
  if (tracksDepth) conflict.status = status;
  Object.assign(conflict, poleFields);

  // An interstate war ends the moment the front hits a pole. A proxy war does not:
  // `resolveColdWarHolds` owns that, because the hold has to be measured on turns
  // where nobody fought — and this function only runs when a battle MOVES the front.
  if (atPole && !isProxyWar) {
    const settled = { ...moved, supplyA, supplyB };
    const victor = control === 0 ? ("A" as const) : ("B" as const);
    const imposer = principalOf(settled, victor);
    const target = principalOf(settled, victor === "A" ? "B" : "A");

    // A DICTATE WINDOW rather than an outright resolve, when there are two
    // governments to address. The fighting stops either way; what the window adds
    // is the victor's choice of term.
    //
    // Both principals must resolve. A generated side has an empty roster and no
    // government to impose terms on, and a side whose founder has already taken a
    // separate peace has nobody left holding the claim. In either case this falls
    // through to the original behaviour, which is a plain resolve.
    if (imposer && target) {
      await openTermsWindow(db, settled, victor, imposer, target, currentTurn);
      // The rosters have gone home even though the war has not ended, so the
      // in-memory document must say so: an offensive still queued for this tick
      // would otherwise fight with troops that are already in reserve. This is the
      // same reason the resolve branch below sets it.
      conflict.status = "terms_pending";
      return { control, standDown: true };
    }

    await resolveConflict(db, settled, victor, currentTurn);
    // Stand-down is part of what this write did, so the in-memory document has to
    // show it too. `resolveConflict` recalls every unit at the front to reserve, so
    // any offensive still queued for this tick would otherwise fight a war that is
    // over, with a roster that has already gone home.
    conflict.status = "resolved";
    return { control, standDown: true };
  }
  return { control, standDown: false };
}

/**
 * Stop the fighting and hand the victor a window to name their terms.
 *
 * Everything `resolveConflict` does to the ARMIES, and nothing it does to the war's
 * record: every belligerent stands down through the same `standDownCountry` the
 * separate-peace path uses, but no winner is stamped, no truce is written, and the
 * status becomes `terms_pending` rather than `resolved`.
 *
 * The truces are deliberately left to the resolve that follows. Writing them here
 * would start the 240 turns from the moment the shooting stopped rather than from
 * the settlement, which would quietly shorten every truce by the length of the
 * window.
 */
async function openTermsWindow(
  db: Db,
  conflict: ConflictDoc,
  victor: "A" | "B",
  imposer: CountryId,
  target: CountryId,
  currentTurn: number
): Promise<void> {
  await getConflictsCollection(db).updateOne(
    { _id: conflict._id },
    {
      $set: {
        status: "terms_pending" as const,
        termsWindow: {
          victor,
          imposer,
          target,
          closesTurn: currentTurn + DICTATE_WINDOW_TURNS,
        },
      },
    }
  );

  for (const countryId of new Set([...conflict.sideA.countries, ...conflict.sideB.countries])) {
    await standDownCountry(db, conflict, countryId);
  }
}

export async function resolveBattleDeclarations(
  db: Db,
  currentTurn: number
): Promise<{ resolved: number; fizzled: number }> {
  const pending = await listPendingDeclarations(db);
  let resolved = 0;
  let fizzled = 0;
  // Most ticks have no offensives filed at all; the bloc roll below costs two reads,
  // so do not pay for them on a quiet turn.
  if (pending.length === 0) return { resolved, fizzled };

  // The era's bloc roll, read ONCE for the whole tick. Every conflict resolved here
  // places its outsiders against the same roll, and a per-conflict read would be the
  // global lookup this replaced in a new costume.
  const blocs = await loadMilitaryBlocs(db);

  // Naval and air state, read ONCE for the whole tick for the same reason as the bloc
  // roll above. Every front resolved here reads the same dispositions, and a per battle
  // load would be hundreds of round trips inside a phase that already has a turn time
  // budget. `navairOperations` wrote this earlier in the same turn.
  const navairChannels = await loadNavairChannels(db);
  const navairUnits = (await getMilitaryUnitsCollection(db)
    .find({ domain: { $in: ["naval", "air"] } })
    .toArray()) as unknown as NavairUnit[];

  // Who fights an offensive here without declaring one: player standing orders, plus
  // the countries the NPP join switch opts in wholesale. Read ONCE for the whole tick
  // for the same reason as the bloc roll above — neither answer can change between
  // fronts, and a per-front read would be a query per theatre inside a phase that
  // already has a turn time budget. The same loader answers the cabinet forecast, so
  // a prediction cannot disagree with the roster that then fights.
  const optInSources = await loadOffensiveOptInSources(db);

  // Group by front so each conflict document is loaded once no matter how many
  // allies declared against it.
  const byTheater = new Map<string, BattleDeclarationDoc[]>();
  for (const d of pending) {
    const list = byTheater.get(d.theaterId) ?? [];
    list.push(d);
    byTheater.set(d.theaterId, list);
  }

  for (const [theaterId, decls] of byTheater) {
    // The conflict must still be live. `getConflict` returns concluded documents
    // too, so without the status check a stale declaration would keep fighting a war
    // that is already over. `isConflictConcluded` rather than a bare "resolved"
    // check: a war awaiting terms has already stood its rosters down, and an
    // offensive queued against it would fight with troops that have gone home.
    const conflict = await getConflict(db, theaterId);
    const eligible = decls.filter((d) => d.declaredTurn < currentTurn);
    if (!conflict || isConflictConcluded(conflict.status)) {
      for (const d of eligible) {
        await mark(db, d, "fizzled", currentTurn);
        fizzled++;
      }
      continue;
    }

    const offensives = mergeOffensives(conflict, decls, currentTurn, blocs);
    // Anything eligible that no offensive claimed could not be resolved to opposing
    // sides, so it fizzles rather than sitting pending forever.
    const claimed = new Set(offensives.flatMap((o) => o.declarations.map((d) => String(d._id))));
    for (const d of eligible) {
      if (claimed.has(String(d._id))) continue;
      await mark(db, d, "fizzled", currentTurn);
      fizzled++;
    }

    const fronts: Record<string, Front> = { [theaterId]: conflictToFront(conflict) };
    const unitsCol = getMilitaryUnitsCollection(db);
    // One query for the whole front. Every belligerent's units are here, and both
    // coalitions are cut from it — a query per contingent would scale with allies.
    const atFront = (await unitsCol.find({ theaterId }).toArray()).filter(
      (u) => u.readyAtTurn == null || u.readyAtTurn <= currentTurn
    );
    // Two views of the same force, and they diverge once the first offensive of the
    // tick is fought. `atFront` stays the opening ROSTER — who was here, which is all
    // `resolveDefendingSides` asks of it, and `countryId`/`theaterId` do not change in
    // battle. `unitsByCountry` is the LIVE pool each offensive builds its sides from,
    // and every battle replaces a contingent's entry with its survivors. Read strength
    // from the map, never from `atFront`.
    const unitsByCountry = new Map<string, typeof atFront>();
    for (const u of atFront) {
      const list = unitsByCountry.get(u.countryId) ?? [];
      list.push(u);
      unitsByCountry.set(u.countryId, list);
    }

    // Allies who fight in an offensive here without declaring one of their own. Cut
    // from the tick-wide sources, because the set cannot change between offensives
    // inside a tick.
    const optedIn = offensiveOptInsAtFront(optInSources, conflict, theaterId);
    if (optedIn.size > 0) {
      for (const off of offensives) {
        // A matchup that resolves to no side enrols nobody -- the same rule that stops
        // it moving ground. Auto-join must not become the way around that.
        if (!off.side) continue;
        for (const c of autoJoinersAtFront(
          conflict,
          atFront,
          theaterId,
          off.side,
          blocs,
          optedIn
        )) {
          if (!off.attackers.includes(c)) off.attackers.push(c);
        }
        // Re-apply `mergeOffensives`' ordering. Auto-joiners arrive in whatever order
        // Mongo returned the theatre states, and the roster is written into the battle
        // report, so leaving it unsorted would make the report vary between ticks on
        // identical input.
        const lead = off.principal.declarerCountry;
        off.attackers = [lead, ...off.attackers.filter((c) => c !== lead).sort()];
      }
    }

    // Set once an offensive drives the front to a pole and ends the war, which can
    // happen partway through a tick that has more offensives queued behind it.
    let standDown = false;

    for (const off of offensives) {
      // Everything still queued after that fizzles: `resolveConflict` has already
      // walked every belligerent out of the theater, so there is no army left here to
      // fight with, and the war it was declared against is over.
      if (standDown) {
        for (const d of off.declarations) await mark(db, d, "fizzled", currentTurn);
        fizzled++;
        continue;
      }
      const principal = off.principal;
      // A resolvable offensive pools every ally defending that side. An unresolvable
      // one has no sides to pool, so it fights the named target alone and moves no
      // ground — the long-standing behaviour for a matchup that cannot be placed.
      // Both arms go through the shared helper — the `length === 0` walkover test
      // below is the same question the forecast asks, and a second copy of it is how
      // a forecast comes to disagree with the outcome it predicts.
      const defending = resolveDefendingSides({
        conflict,
        atFront,
        theaterId,
        enemySide: off.enemySide,
        blocs,
        namedTarget: principal.targetCountry,
        unitsByCountry,
      });
      const defenders = defending.defenderCountries;

      // Each side fights on its own derived supply — occupation degrades whoever is
      // being pushed back. An unplaced side fights at neutral supply.
      const supplyFor = (side: Side | null) =>
        side === "A" ? conflict.supplyA : side === "B" ? conflict.supplyB : undefined;

      if (defending.unopposed) {
        // Nobody home: the offensive walks forward. Without this, a nation that never
        // deploys anything is permanently immune to invasion.
        const walkoverBefore = conflict.control;
        let walkoverAfter = walkoverBefore;
        if (off.side) {
          for (const c of off.attackers) await joinSide(db, conflict, c, off.side, currentTurn);
          const occupied = await applyOccupation(
            db,
            conflict,
            off.side,
            OCCUPATION.decisiveMargin,
            false,
            currentTurn
          );
          walkoverAfter = occupied.control;
          standDown = occupied.standDown;
        }
        const advanced = walkoverAfter !== walkoverBefore;
        await getBattleReportsCollection(db).insertOne({
          theaterId,
          declarerCountry: principal.declarerCountry,
          targetCountry: principal.targetCountry,
          attackers: off.attackers,
          defenders: [],
          turn: currentTurn,
          result: null,
          noContact: true,
          unopposedAdvance: advanced,
          controlBefore: walkoverBefore,
          controlAfter: walkoverAfter,
        } as never);
        for (const d of off.declarations) {
          await mark(db, d, advanced ? "resolved" : "fizzled", currentTurn);
        }
        if (advanced) resolved++;
        else fizzled++;
        continue;
      }

      // Enrol every belligerent BEFORE resolution, so the roster the report is
      // written against matches the army that actually fought. An unplaced matchup
      // enrols nobody: there is no side to enrol them onto.
      if (off.side && off.enemySide) {
        for (const c of off.attackers) await joinSide(db, conflict, c, off.side, currentTurn);
        for (const c of defenders) {
          // A faction is never enrolled into a roster: it IS the side, named by
          // `factionEntity`. Writing it into `sideX.countries` would list North
          // Vietnam as a member country of its own side, and would put a
          // non-CountryId into a field every belligerent list reads as one.
          if (isFactionEntity(conflict, c)) continue;
          await joinSide(db, conflict, c as CountryId, off.enemySide, currentTurn);
        }
      }

      const [attackerSides, defenderSides] = await Promise.all([
        buildCoalitionSide(
          db,
          off.attackers,
          unitsByCountry,
          fronts,
          supplyFor(off.side),
          off.side ?? undefined
        ),
        buildCoalitionSide(
          db,
          defenders,
          unitsByCountry,
          fronts,
          supplyFor(off.enemySide),
          off.enemySide ?? undefined
        ),
      ]);

      // A faction owns no unit rows, so without this its side reaches the battle math
      // empty and the attacker walks through it every single turn.
      const factionSide = defending.factionDefends
        ? buildFactionSide(conflict, defending.factionDefends, fronts[theaterId]!)
        : null;
      if (factionSide && factionSide.units.length > 0) {
        factionSide.conflictSupply = supplyFor(defending.factionDefends);
        defenderSides.push(factionSide);
      }

      // What the naval and air layer delivered to each side at this front. Computed
      // from state `navairOperations` already wrote this turn, so a battle reads
      // current dispositions rather than producing them.
      const frontRegion = conflict.region;
      const supportA = frontSupportFor(
        navairUnits,
        navairChannels,
        attackerSides.map((c) => c.country),
        frontRegion
      );
      const supportD = frontSupportFor(
        navairUnits,
        navairChannels,
        defenderSides.map((c) => c.country),
        frontRegion
      );

      const result = resolvePvpBattle(
        attackerSides,
        defenderSides,
        theaterId,
        hashStr(String(principal._id) + currentTurn),
        supportA,
        supportD
      );

      // Persist per contingent: `persistSide` scopes its unit filter to that
      // contingent's country and credits only its own generals, so each nation
      // bleeds its own troops and earns its own experience.
      //
      // The survivors go back into `unitsByCountry`, which is the pool every later
      // offensive in this tick builds its sides from. A nation that attacks and is
      // then counter-attacked fights the second engagement with the army the first
      // one left it, and its losses accumulate instead of the later write undoing
      // the earlier one.
      for (const c of attackerSides) {
        unitsByCountry.set(c.country, await persistSide(db, c, result.attacker, result.win));
      }
      for (const c of defenderSides) {
        // The synthetic side has no `militaryUnits` rows and no generals — persisting
        // it would bulk-write against a countryId that owns nothing. Its casualties go
        // onto the conflict's `tokenStrength` below instead.
        if (factionSide && c.country === factionSide.country) continue;
        unitsByCountry.set(c.country, await persistSide(db, c, result.defender, !result.win));
      }

      // ⚠️ Deliberately its own write, NOT folded into `applyOccupation`'s `$set`:
      // that function early-returns when `control` does not move, which is every
      // battle once the front is pinned at a pole — exactly the state the three-turn
      // hold is about. A stalemated front would grind the token force every turn and
      // record none of it, which is the immortal wall this mechanism removes.
      if (factionSide && factionSide.units.length > 0) {
        const lost = factionLoss(result.defender, factionSide.country);
        if (lost > 0) {
          const key = defending.factionDefends === "A" ? "sideA" : "sideB";
          const before =
            (defending.factionDefends === "A"
              ? conflict.sideA.tokenStrength
              : conflict.sideB.tokenStrength) ?? 0;
          const after = Math.max(0, before - lost);
          await getConflictsCollection(db).updateOne(
            { _id: conflict._id },
            { $set: { [`${key}.tokenStrength`]: after } }
          );
          // In memory too, like every other write this tick makes: `buildFactionSide`
          // fields the token force from this number, so a later offensive would
          // otherwise re-mint the men just killed.
          conflict[key].tokenStrength = after;
        }
      }

      // Territory: the winner pushes the front toward the loser's pole. A side that
      // broke off yields ground more cheaply than one broken in place. A matchup that
      // could not be placed fights, but moves nothing.
      //
      // `occupationShift` is pure and is exactly what `applyOccupation` will write, so
      // the report can name the ground BEFORE the territorial write happens. Computing
      // it rather than reordering the writes is deliberate: `persistSide` has already
      // bled the units, and nothing here is transactional, so the report and the
      // `mark` must land first. Writing them after `applyOccupation` would mean a
      // throw there left the declarations unresolved, and next turn would fight the
      // same battle again and take the casualties twice.
      const controlBefore = conflict.control;
      let controlAfter = controlBefore;
      let winner: Side | null = null;
      let loserRetreated = false;
      if (off.side && off.enemySide) {
        winner = result.win ? off.side : off.enemySide;
        // battle.ts picks the breaking side as the one with the lower round track, and
        // the higher track wins — so a retreat is always the loser's.
        loserRetreated =
          result.retreat !== null && (result.retreat.side === "attacker") !== result.win;
        controlAfter = occupationShift({
          control: controlBefore,
          winner,
          margin: result.margin,
          loserRetreated,
          turnsElapsed: currentTurn - conflict.startTurn,
        });
      }

      await getBattleReportsCollection(db).insertOne({
        theaterId,
        declarerCountry: principal.declarerCountry,
        targetCountry: principal.targetCountry,
        attackers: off.attackers,
        defenders,
        turn: currentTurn,
        result,
        controlBefore,
        controlAfter,
      } as never);
      for (const d of off.declarations) await mark(db, d, "resolved", currentTurn);

      if (winner) {
        const occupied = await applyOccupation(
          db,
          conflict,
          winner,
          result.margin,
          loserRetreated,
          currentTurn
        );
        standDown = occupied.standDown;
      }
      resolved++;
    }
  }

  return { resolved, fizzled };
}
