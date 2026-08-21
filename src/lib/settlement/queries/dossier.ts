/**
 * The German Question dossier read model — the single place that turns game
 * state into the ~30 values the board displays.
 *
 * EVERY FIELD HERE IS LIVE. The source mockup is placeholder data end to end
 * (see `ahd-german-question-live-data-contract`): its Bundestag "496 seats"
 * contradicts the 1953 seed's 487, its delegation point totals are literal
 * ternaries, its open-floor count and its whole news wire are hardcoded arrays.
 * Anything that cannot be sourced is a gap to raise, never a literal to keep.
 *
 * One read model rather than per-component queries so the page does no
 * database work and the GET route can hand the client the identical shape after
 * a play lands.
 */
import type { Db, ObjectId } from "mongodb";
import type { Character, GameState, PoliticalParty, State } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { SettlementPlayDoc } from "@/lib/db/types/settlementPlay";
import type { SettlementSeatState } from "@/lib/db/types/settlementCrisis";
import {
  HUNDREDTHS,
  LADDER_RUNGS,
  MAX_COERCIVE_RUNG,
  PERSONAL_NET_CAP,
  PERSONAL_MULTIPLIER_PCT,
  SETTLEMENT_SEATS,
  driftBandLabel,
  getInstitution,
  getPlay,
  playsForSeat,
  settlementRulesFor,
  type SettlementPlayDef,
  type SettlementRules,
} from "@/lib/constants/settlementCrisis";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { formatLocalFunds } from "@/lib/actions";
import { getSettlementCrisesCollection, getSettlementPlaysCollection } from "@/lib/db/collections";
import { defconFor, isArmed } from "../outcome";
import { canCharacterAfford, canSeatAfford, seatBudgetFor } from "../affordability";
import { loadSettlementActorContext } from "../actorContext";
import { resolvePersonalFunds } from "../playCost";

export interface DossierPlayView {
  id: string;
  /**
   * Which catalogue this came from.
   *
   * Carried per play, not inferred from the viewer's current mode: the two
   * catalogues are merged into one list per institution, and committing a
   * personal play as a seat (or the reverse) is refused 403 by the command. The
   * card filters on this so it never offers a play that cannot succeed.
   */
  actor: "seat" | "personal";
  name: string;
  detail: string;
  tag: string;
  danger: boolean;
  /** Signed, AFTER the multiplier, in points. */
  effectivePoints: number;
  /** "8.0 base × 2.0× seat" — the explanation under the number. */
  basisLabel: string;
  costLabel: string;
  affordable: boolean;
  blockedReason: string | null;
}

export interface DossierInstitutionView {
  id: string;
  name: string;
  subtitle: string;
  weightTag: string;
  eastPct: number;
  westPct: number;
  driftNote: string;
  driftDirection: "east" | "west" | "none";
  holder: "NATO" | "PACT";
  lastPlayLabel: string | null;
  plays: DossierPlayView[];
  gateNote: string | null;
}

export interface DossierBenchView {
  seatId: string;
  name: string;
  tier: string;
  multiplier: string;
  bloc: "west" | "east";
  committedPoints: number;
  barPct: number;
  actedThisTurn: boolean;
  isViewer: boolean;
}

export interface DossierWireLine {
  at: string;
  who: string;
  bloc: "west" | "east" | "open" | "bonn";
  text: string;
}

export interface DossierSeatView {
  id: string;
  name: string;
  tier: string;
  multiplier: string;
  capital: number;
  capitalLabel: string;
  treasuryLabel: string;
  /** Banked and spendable now. May exceed `actionsPerTurn`. */
  actionsRemaining: number;
  /** Granted each tick. */
  actionsPerTurn: number;
  /** The bank's ceiling - what "full" means on the AP readout. */
  actionsBankCap: number;
  canAct: boolean;
  blockedReason: string | null;
  canEscalate: boolean;
  /** Authority AND the ladder is at the cap right now — the button is live. */
  canArmNow: boolean;
  escalateGate: string | null;
}

export interface DossierView {
  crisisId: string;
  turn: number;
  /** ISO. The client ticks the countdown; the server does not format it. */
  nextTurnAt: string | null;
  eastPct: number;
  westPct: number;
  leadNote: string;
  heat: number;
  defcon: number;
  /** Rung 5 reached — the levy is running and a declaration is unlocked. */
  armed: boolean;
  ladder: { num: number; label: string; here: boolean; passed: boolean }[];
  drift: { last: number; history: number[]; revealed: boolean; band: string | null };
  institutions: DossierInstitutionView[];
  benches: { west: DossierBenchView[]; east: DossierBenchView[] };
  openFloor: {
    characters: number;
    /** Net points the personal tier actually bought, after the cap. */
    netPoints: number;
    /** What it asked for, before the cap. Equal to `netPoints` when uncapped. */
    rawPoints: number;
    capPoints: number;
    capped: boolean;
  };
  settlementPlays: DossierPlayView[];
  wire: DossierWireLine[];
  /** The admin rule switches, so the board can render what is switched off. */
  rules: SettlementRules;
  viewer: { seat: DossierSeatView | null; personalActions: number };
}

const EAST_SEATS = new Set<string>(["DD", "RU"]);
/**
 * Hundredths to display points, at ONE decimal.
 *
 * The grid is hundredths, so the raw division yields two — and the complement
 * (`100 - east`) was separately rounded to one, so every pair on the board read
 * "56.4% NATO / 43.62% PACT". Two halves of one split cannot disagree about
 * their own precision; rounding here makes them agree by construction.
 */
const pts = (hundredths: number) => Math.round((hundredths / HUNDREDTHS) * 10) / 10;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

/**
 * A PLAY's worth in points, to two decimals.
 *
 * Positions keep one decimal so the two halves of a split still read 100.0,
 * but a single play at the tuned tempo is worth a fraction of a point — the
 * three personal plays span 0.04 to 0.07, and at one decimal all three round
 * to the same "0.1" and hide a 2x spread.
 */
const magPts = (hundredths: number) => Math.round((hundredths / HUNDREDTHS) * 100) / 100;
const signedMag = (hundredths: number) =>
  `${hundredths >= 0 ? "+" : ""}${magPts(hundredths).toFixed(2)}`;

/** Escalation authority copy, verbatim from the source design. */
function escalateGateFor(seatId: string): string {
  if (seatId === "DD") {
    return "Only Washington and Moscow hold the escalation authority. East Berlin can raise the temperature with coercive plays, but it cannot take the bloc to the ladder.";
  }
  if (seatId === "UK") {
    return "Escalation on the ladder is a superpower decision — London can reinforce and protest, not mobilise the alliance.";
  }
  return "This seat has no escalation authority. Coercive plays still add heat to the ladder.";
}

/**
 * The Bundestag's live composition.
 *
 * The mockup says "496 seats"; the 1953 seed sums to 487 and a later election
 * will move it again, so this counts rather than quoting either number.
 */
async function bundestagSubtitle(db: Db): Promise<string> {
  const formation = await db
    .collection<GovernmentFormation>("governmentFormations")
    .findOne({ _id: "DE" }, { projection: { seatsByParty: 1 } });

  const seatsByParty = formation?.seatsByParty ?? {};
  const entries = Object.entries(seatsByParty).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, seats]) => sum + seats, 0);
  if (total === 0) return "Bonn";

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { countryId: "DE", sequentialId: { $in: entries.map(([id]) => Number(id)) } },
      { projection: { sequentialId: 1, name: 1, abbreviation: 1 } }
    )
    .toArray();
  const nameById = new Map(parties.map((p) => [String(p.sequentialId), p.name]));

  const top = entries
    .slice(0, 3)
    .map(([id]) => nameById.get(id))
    .filter((n): n is string => Boolean(n));

  return top.length > 0 ? `Bonn · ${total} seats · ${top.join("–")}` : `Bonn · ${total} seats`;
}

/** The Länder card's live subtitle — how many state governments there are. */
async function laenderSubtitle(db: Db): Promise<string> {
  const count = await db
    .collection<State>("states")
    .countDocuments({ countryId: "DE", regionType: "state" });
  return `${count} state governments · Bundesrat bloc`;
}

/** One play as the board shows it, priced and gated for this viewer. */
function playView(params: {
  play: SettlementPlayDef;
  actor: "seat" | "personal";
  multiplierPct: number;
  direction: 1 | -1 | null;
  multiplierLabel: string;
  currency: CountryId | null;
  /** Personal plays: the converted local cost, so the card never shows anchor. */
  localFundsOverride?: number;
  affordable: boolean;
  blockedReason: string | null;
}): DossierPlayView {
  const { play, multiplierPct, direction, multiplierLabel } = params;
  const magnitude = (play.magnitude * multiplierPct) / 100;
  // Direction is unknown for a seat with no bloc; show the magnitude unsigned
  // rather than guessing a side.
  const effective = direction === null ? magnitude : magnitude * direction;

  const costBits: string[] = [];
  if (play.capitalCost > 0) costBits.push(`${play.capitalCost} capital`);
  const fundsShown = params.localFundsOverride ?? play.fundsCost;
  if (fundsShown > 0) {
    costBits.push(
      params.currency
        ? formatLocalFunds(fundsShown, COUNTRY_CURRENCY_MAP[params.currency])
        : // A personal play's cost is already converted to the viewer's local
          // currency by `resolvePersonalFunds`; the symbol is theirs, not a
          // seat's, so it is left to the client's own formatter.
          fundsShown.toLocaleString()
    );
  }
  costBits.push(`${play.actionCost} AP`);

  return {
    id: play.id,
    actor: params.actor,
    name: play.name,
    detail: play.detail,
    tag: play.class.toUpperCase(),
    danger: play.addsHeat,
    effectivePoints: magPts(effective),
    basisLabel: `${magPts(play.magnitude).toFixed(2)} base × ${multiplierLabel}`,
    costLabel: costBits.join(" · "),
    affordable: params.affordable,
    blockedReason: params.blockedReason,
  };
}

export async function loadGermanQuestionDossier(
  db: Db,
  characterId: ObjectId
): Promise<DossierView | null> {
  const ctx = await loadSettlementActorContext(db, characterId);
  if (!ctx || !ctx.crisisId) return null;

  const crises = await getSettlementCrisesCollection(db);
  const crisis = await crises.findOne({ status: "open" });
  if (!crisis) return null;

  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1, nextScheduledTurn: 1 } });
  const turn = gameState?.currentTurn ?? 0;

  const rules = settlementRulesFor(crisis);

  // ── this turn's plays, for the open floor and the wire ────────────────────
  //
  // Projected rather than read whole: the personal tier is one row per
  // character who acted, so this is the one query on the board whose size grows
  // with the player count. The `{ crisisId, turn }` index makes it a scan of
  // exactly this turn's rows.
  const playsCol = await getSettlementPlaysCollection(db);
  const thisTurn = (await playsCol
    .find(
      { crisisId: crisis._id, turn },
      {
        projection: {
          actor: 1,
          seatId: 1,
          playId: 1,
          characterId: 1,
          targetInstitutionId: 1,
          basePoints: 1,
          direction: 1,
          appliedPoints: 1,
          turn: 1,
        },
      }
    )
    .toArray()) as SettlementPlayDoc[];

  const personal = thisTurn.filter((p) => p.actor === "personal");
  const personalRawByInstitution = new Map<string, number>();
  let personalRawTotal = 0;
  for (const p of personal) {
    if (!p.targetInstitutionId) continue;
    const raw = Math.round((p.basePoints * PERSONAL_MULTIPLIER_PCT) / 100) * p.direction;
    personalRawTotal += raw;
    personalRawByInstitution.set(
      p.targetInstitutionId,
      (personalRawByInstitution.get(p.targetInstitutionId) ?? 0) + raw
    );
  }
  const openFloor = {
    characters: new Set(personal.map((p) => String(p.characterId))).size,
    netPoints: pts(personal.reduce((sum, p) => sum + (p.appliedPoints ?? 0), 0)),
    rawPoints: pts(personalRawTotal),
    capPoints: magPts(PERSONAL_NET_CAP),
    capped: [...personalRawByInstitution.values()].some((v) => Math.abs(v) > PERSONAL_NET_CAP),
  };

  // ── institutions ──────────────────────────────────────────────────────────
  const seat = ctx.seat;
  const seatDef = seat ? SETTLEMENT_SEATS.find((s) => s.id === seat.id) : undefined;
  const seatState = seat ? crisis.seats.find((s) => s.id === seat.id) : undefined;
  const budget = seat && seatState ? seatBudgetFor(seatState, seat.id) : null;
  const treasury = seat
    ? await db
        .collection<FederalBudget>("federalBudget")
        .findOne(
          { countryId: seat.id as FederalBudget["countryId"] },
          { projection: { treasuryBalance: 1 } }
        )
    : null;

  const [bundestagSub, laenderSub] = await Promise.all([
    bundestagSubtitle(db),
    laenderSubtitle(db),
  ]);
  const liveSubtitle: Record<string, string> = {
    bundestag: bundestagSub,
    laender: laenderSub,
  };

  const catalogue = seat ? playsForSeat(seat.id) : [];
  const personalCatalogue = playsForSeat(null);

  // The viewer's own money, so a personal play a broke character cannot afford
  // renders disabled here instead of looking live and being refused by the
  // route. `resolvePersonalFunds` short-circuits the FX lookup for free plays,
  // so this costs at most one rate read for the whole board.
  const character = await db
    .collection<Character>("characters")
    .findOne(
      { _id: characterId },
      { projection: { actions: 1, funds: 1, currencyBalances: 1, countryId: 1 } }
    );
  const personalCost = new Map<string, { local: number; balance: number }>();
  if (character) {
    for (const play of personalCatalogue) {
      const resolved = await resolvePersonalFunds(db, character, play);
      personalCost.set(play.id, { local: resolved.local, balance: resolved.balanceLocal });
    }
  }

  const buildPlays = (institutionId: string | null): DossierPlayView[] => {
    const views: DossierPlayView[] = [];
    if (seat && seatDef && budget) {
      for (const play of catalogue.filter((p) => p.target === institutionId)) {
        const check = canSeatAfford(play, budget, treasury?.treasuryBalance ?? 0);
        views.push(
          playView({
            play,
            actor: "seat",
            multiplierPct: seatDef.multiplierPct,
            direction: seat.direction,
            multiplierLabel: `${(seatDef.multiplierPct / 100).toFixed(1)}× seat`,
            currency: seat.id as CountryId,
            affordable: seat.canAct && check.ok,
            blockedReason: seat.blockedReason ?? check.reason ?? null,
          })
        );
      }
    }
    for (const play of personalCatalogue.filter((p) => p.target === institutionId)) {
      const money = personalCost.get(play.id);
      const check = canCharacterAfford(
        // Compare in the units the balance is actually stored in: the
        // catalogue's figure is ANCHOR, the balance is local.
        { ...play, fundsCost: money?.local ?? play.fundsCost },
        ctx.personal.actionsRemaining,
        money?.balance ?? 0
      );
      views.push(
        playView({
          play,
          actor: "personal",
          multiplierPct: PERSONAL_MULTIPLIER_PCT,
          // Personal plays choose their own side, so the board shows the
          // magnitude and the card offers the direction.
          direction: null,
          multiplierLabel: "0.25× personal",
          currency: null,
          localFundsOverride: money?.local,
          affordable: check.ok,
          blockedReason: check.reason ?? null,
        })
      );
    }
    return views;
  };

  const institutions: DossierInstitutionView[] = crisis.institutions.map((inst) => {
    const def = getInstitution(inst.id);
    const eastPct = pts(inst.position);
    const drift = pts(inst.lastDrift);
    const plays = buildPlays(inst.id);
    return {
      id: inst.id,
      name: def?.name ?? inst.id,
      subtitle: liveSubtitle[inst.id] ?? def?.flavour ?? "",
      weightTag: `×${inst.weight} WEIGHT`,
      eastPct,
      westPct: Math.round((100 - eastPct) * 10) / 10,
      driftNote: drift === 0 ? "0.0 · steady" : `${signed(drift)} → ${drift > 0 ? "PACT" : "NATO"}`,
      driftDirection: drift === 0 ? "none" : drift > 0 ? "east" : "west",
      holder: eastPct > 50 ? "PACT" : "NATO",
      lastPlayLabel: inst.lastPlay ? `last play: ${inst.lastPlay.label}` : null,
      plays,
      gateNote:
        plays.length > 0
          ? null
          : seat
            ? "this seat has no lever on this institution."
            : "open plays only reach the street and the Bundestag.",
    };
  });

  // ── benches ───────────────────────────────────────────────────────────────
  const maxCommitted = Math.max(1, ...crisis.seats.map((s) => s.committedPoints));
  const bench = (state: SettlementSeatState): DossierBenchView => {
    const def = SETTLEMENT_SEATS.find((s) => s.id === state.id)!;
    return {
      seatId: state.id,
      name: def.name,
      tier: def.tier.toUpperCase(),
      multiplier: `${(def.multiplierPct / 100).toFixed(1)}×`,
      bloc: EAST_SEATS.has(state.id) ? "east" : "west",
      committedPoints: pts(state.committedPoints),
      // Guarded against an all-zero board: every bar reads empty rather than NaN.
      barPct: Math.round((state.committedPoints / maxCommitted) * 100),
      actedThisTurn: state.lastActedTurn === turn,
      isViewer: seat?.id === state.id,
    };
  };
  const benches = {
    west: crisis.seats.filter((s) => !EAST_SEATS.has(s.id)).map(bench),
    east: crisis.seats.filter((s) => EAST_SEATS.has(s.id)).map(bench),
  };

  // ── wire ──────────────────────────────────────────────────────────────────
  // A CLOSED log carries only what has already happened. Pending commitments
  // are withheld from everyone including the delegation that made them, because
  // a line only this viewer can see is a line they can screenshot — the rule is
  // "nobody reads the board before the tick", not "everybody but you".
  const logged = rules.openLog ? thisTurn : thisTurn.filter((p) => p.appliedPoints !== null);
  const wire: DossierWireLine[] = [];
  // Seat plays are named individually; the personal tier is one aggregate line
  // below. Listing every character's op-ed would push the four delegations off
  // an eight-line wire on any turn the public turned out.
  for (const p of [...logged].reverse().filter((p) => p.actor !== "personal")) {
    const def = getPlay(p.playId);
    const applied = p.appliedPoints;
    const toward = (applied ?? p.direction * p.basePoints) >= 0 ? "reunification" : "NATO";
    wire.push({
      at: `T-${p.turn}`,
      // The capital, not the seat id — the wire reads "EAST BERLIN opens the
      // inner border", never "DD opens the inner border".
      who: p.seatId
        ? (SETTLEMENT_SEATS.find((s) => s.id === p.seatId)?.wireLabel ?? p.seatId)
        : "OPEN FLOOR",
      bloc: p.seatId ? (EAST_SEATS.has(p.seatId) ? "east" : "west") : "open",
      text:
        applied === null
          ? `plays “${def?.name ?? p.playId}”. Resolves on the next tick.`
          : `plays “${def?.name ?? p.playId}”. ${p.targetInstitutionId ? "Institution" : "Settlement"} moves ${signedMag(applied)} toward ${toward}.`,
    });
  }
  // The cap must never be silent (design §4): whenever the public moved, the
  // wire says what it asked for AND what it bought, so a throttled turnout is
  // visible as a throttle rather than as a disappointing result.
  const loggedPersonal = logged.filter((p) => p.actor === "personal");
  if (loggedPersonal.length > 0) {
    const applied = pts(loggedPersonal.reduce((sum, p) => sum + (p.appliedPoints ?? 0), 0));
    const pending = loggedPersonal.every((p) => p.appliedPoints == null);
    wire.unshift({
      at: `T-${turn}`,
      who: "OPEN FLOOR",
      bloc: "open",
      text: pending
        ? `${openFloor.characters} characters have moved. Resolves on the next tick.`
        : `${openFloor.characters} characters moved ${signed(openFloor.rawPoints)}; ${signed(applied)} applied` +
          (openFloor.capped
            ? `, capped at ±${openFloor.capPoints.toFixed(2)} per institution.`
            : `, under the ±${openFloor.capPoints.toFixed(2)} cap.`),
    });
  }

  const lastDrift = crisis.driftHistory[0];
  if (lastDrift !== undefined) {
    wire.unshift({
      at: `T-${turn}`,
      who: "BONN",
      bloc: "bonn",
      text: rules.driftRevealed
        ? `drifts ${signed(pts(lastDrift))} on its own. Band disclosed: ${driftBandLabel()}.`
        : `drifts ${signed(pts(lastDrift))} on its own. Band was not disclosed before the tick.`,
    });
  }

  // ── masthead ──────────────────────────────────────────────────────────────
  const eastPct = pts(crisis.position);
  const westPct = Math.round((100 - eastPct) * 10) / 10;
  const leadNote =
    eastPct > westPct
      ? `reunification leads by ${(eastPct - westPct).toFixed(0)} — ${(85 - eastPct).toFixed(0)} to carry`
      : `sovereignty leads by ${(westPct - eastPct).toFixed(0)} — ${(eastPct - 15).toFixed(0)} to lock`;

  return {
    crisisId: crisis._id.toString(),
    turn,
    nextTurnAt: gameState?.nextScheduledTurn?.toISOString() ?? null,
    eastPct,
    westPct,
    leadNote,
    heat: crisis.ladder.heat,
    defcon: defconFor(crisis.ladder.heat),
    armed: isArmed(crisis.ladder.heat),
    ladder: LADDER_RUNGS.map((label, i) => ({
      num: i + 1,
      label,
      here: i + 1 === crisis.ladder.heat,
      passed: i + 1 < crisis.ladder.heat,
    })),
    drift: {
      last: pts(crisis.driftHistory[0] ?? 0),
      history: crisis.driftHistory.map(pts),
      revealed: rules.driftRevealed,
      band: rules.driftRevealed ? driftBandLabel() : null,
    },
    institutions,
    benches,
    openFloor,
    settlementPlays: buildPlays(null),
    wire: wire.slice(0, 8),
    rules,
    viewer: {
      seat:
        seat && seatDef && budget
          ? {
              id: seat.id,
              name: seatDef.name,
              tier: seatDef.tier.toUpperCase(),
              multiplier: `${(seatDef.multiplierPct / 100).toFixed(1)}×`,
              capital: budget.capital,
              capitalLabel: seatDef.capitalLabel,
              treasuryLabel: formatLocalFunds(
                treasury?.treasuryBalance ?? 0,
                COUNTRY_CURRENCY_MAP[seat.id as CountryId]
              ),
              actionsRemaining: budget.actionsRemaining,
              actionsPerTurn: budget.actionsPerTurn,
              actionsBankCap: budget.actionsBankCap,
              canAct: seat.canAct,
              blockedReason: seat.blockedReason,
              canEscalate: seatDef.authority && rules.escalationEnabled,
              canArmNow:
                seatDef.authority &&
                rules.escalationEnabled &&
                seat.direction !== null &&
                crisis.ladder.heat === MAX_COERCIVE_RUNG,
              // The switched-off reason outranks the no-authority one: a
              // Washington seat told "you have no authority" when the real
              // answer is "nobody does right now" would be a lie.
              escalateGate: !rules.escalationEnabled
                ? "The escalation ladder is switched off for this question. Coercive plays still land; they simply leave no heat."
                : seatDef.authority
                  ? null
                  : escalateGateFor(seat.id),
            }
          : null,
      personalActions: ctx.personal.actionsRemaining,
    },
  };
}
