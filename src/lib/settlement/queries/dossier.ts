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
  LADDER_UNLOCK_TURNS,
  MAX_COERCIVE_RUNG,
  PERSONAL_PLAY_USES_PER_TURN,
  personalNetCapFor,
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
import { resolveSeatOffices, type SettlementSeatOffice } from "../seatOffices";
import { capitalPriceFor } from "../capitalPrice";
import { resolvePlayBatch } from "../resolvePlays";
import { computeFiscalImpact } from "@/lib/budget/fiscalImpact";
import type { SettlementPaymentMode } from "@/lib/db/types/settlementPlay";
import { loadSettlementActorContext } from "../actorContext";
import { resolvePersonalFunds } from "../playCost";

export interface DossierPaymentView {
  mode: SettlementPaymentMode;
  /** Button copy. "TREASURY" or "CAPITAL", or "COMMIT" when there is only one. */
  label: string;
  /** "£25M · 1 AP" or "16 capital · 1 AP". */
  costLabel: string;
  affordable: boolean;
  blockedReason: string | null;
  /**
   * Set when this route would borrow, naming the shortfall.
   *
   * Load-bearing, not decoration. Spending into debt is allowed, so the cash
   * button is ALWAYS live and nothing else on the board distinguishes spending
   * savings from taking a loan — which is also the only reason to prefer the
   * capital route.
   */
  debtNote: string | null;
}

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
  /**
   * One entry per route this play can be bought with, cash first. Always at
   * least one, so personal plays and the four capital-only plays take the same
   * code path and the card renders a single loop with no special case.
   */
  payments: DossierPaymentView[];
}

/**
 * One institution's per-turn personal-tier cap usage.
 *
 * The cap itself comes from `personalNetCapFor` and bites in `resolvePlayBatch`
 * at the tick; this carries what the board needs to show how much of it this
 * turn has already spent. Null on institutions the personal tier cannot reach,
 * where a meter would imply a limit that never applies.
 */
export interface DossierInstitutionCapView {
  /** Signed points the open floor asked for here this turn, before the cap. */
  rawPoints: number;
  /** What the tier will move here after the cap: clamped to ±capPoints. */
  netPoints: number;
  /** The ceiling itself, so the card quotes the rule next to the usage. */
  capPoints: number;
  /**
   * The raw ask has reached the cap. From here on further personal plays
   * change nothing on this institution until the next tick, so this is the
   * state the board must make unmistakable.
   */
  maxed: boolean;
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
  personalCap: DossierInstitutionCapView | null;
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
  /**
   * The two offices that can act for this delegation, head of government
   * first. Always both, even when neither is held — the block names the
   * offices, and an unheld one reads as `vacant`.
   */
  offices: SettlementSeatOffice[];
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
  /** Turn the brink becomes available at all. See LADDER_UNLOCK_TURNS. */
  opensAtTurn: number;
  /** Zero once the four-power channel has run its course. */
  turnsUntilOpen: number;
  ladder: { num: number; label: string; here: boolean; passed: boolean }[];
  drift: { last: number; history: number[]; revealed: boolean; band: string | null };
  institutions: DossierInstitutionView[];
  benches: { west: DossierBenchView[]; east: DossierBenchView[] };
  openFloor: {
    characters: number;
    /**
     * Net points the personal tier moves this turn, after the cap.
     *
     * A STAMPED row is read off its stamp; an unstamped one is PROJECTED
     * through the resolver, because `appliedPoints` does not exist until the
     * phase writes it. The two agree by construction, since the resolver makes
     * the stamps sum to the same clamped figure the projection computes — but
     * preferring the stamp matters in the window between the phase settling a
     * turn and the clock advancing, where recomputing would restate a settled
     * row under whatever ceiling is current now.
     */
    netPoints: number;
    /** What it asked for, before the cap. Equal to `netPoints` when uncapped. */
    rawPoints: number;
    /**
     * The largest ceiling in play this turn. Derived from turnout rather than
     * fixed, so it rises as more characters take part — see
     * `personalNetCapFor`.
     */
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

/**
 * One route's cost line: capital, then money, then AP, omitting the zeroes.
 *
 * `capital` and `fundsShown` are passed rather than read off the play, because
 * the two routes charge different amounts for the same play.
 */
function costLabelFor(
  play: SettlementPlayDef,
  capital: number,
  fundsShown: number,
  currency: CountryId | null
): string {
  const bits: string[] = [];
  if (capital > 0) bits.push(`${capital} capital`);
  if (fundsShown > 0) {
    bits.push(
      currency
        ? formatLocalFunds(fundsShown, COUNTRY_CURRENCY_MAP[currency])
        : // A personal play's cost is already converted to the viewer's local
          // currency by `resolvePersonalFunds`; the symbol is theirs, not a
          // seat's, so it is left to the client's own formatter.
          fundsShown.toLocaleString()
    );
  }
  bits.push(`${play.actionCost} AP`);
  return bits.join(" · ");
}

/**
 * The seat's cash position, named for what it actually is.
 *
 * `treasuryBalance` is SIGNED and `formatLocalFunds` puts the sign after the
 * symbol, so a seat in the red rendered as "M-500,000,000 treasury". Since
 * delegations borrow routinely now, that is the normal case rather than an edge
 * one. The label carries its own noun, so the Masthead does not append one.
 */
function treasuryLabelFor(balance: number, countryId: CountryId): string {
  const money = formatLocalFunds(Math.abs(balance), COUNTRY_CURRENCY_MAP[countryId]);
  return balance < 0 ? `${money} national debt` : `${money} treasury`;
}

/** One play as the board shows it, with every route it can be bought through. */
function playView(params: {
  play: SettlementPlayDef;
  actor: "seat" | "personal";
  multiplierPct: number;
  direction: 1 | -1 | null;
  multiplierLabel: string;
  payments: DossierPaymentView[];
}): DossierPlayView {
  const { play, multiplierPct, direction, multiplierLabel } = params;
  const magnitude = (play.magnitude * multiplierPct) / 100;
  // Direction is unknown for a seat with no bloc; show the magnitude unsigned
  // rather than guessing a side.
  const effective = direction === null ? magnitude : magnitude * direction;

  return {
    id: play.id,
    actor: params.actor,
    name: play.name,
    detail: play.detail,
    tag: play.class.toUpperCase(),
    danger: play.addsHeat,
    effectivePoints: magPts(effective),
    basisLabel: `${magPts(play.magnitude).toFixed(2)} base × ${multiplierLabel}`,
    payments: params.payments,
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
  // The brink is gated on the crisis's age, not on the board — see
  // LADDER_UNLOCK_TURNS. Computed once here because both the ladder panel's
  // countdown and each seat's escalate gate quote it.
  // `?? 0` mirrors `armSettlementLadder`'s own fallback: the two must agree,
  // or the panel offers a button the command refuses.
  const ladderOpensAt = (crisis.openedTurn ?? 0) + LADDER_UNLOCK_TURNS;
  const ladderIsOpen = turn >= ladderOpensAt;

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
  // Distinct characters PER INSTITUTION, because that is what sizes each pool.
  // A character pushing two levers on the street is one participant there.
  const participantsByInstitution = new Map<string, Set<string>>();
  for (const p of personal) {
    if (!p.targetInstitutionId) continue;
    const seen = participantsByInstitution.get(p.targetInstitutionId) ?? new Set<string>();
    seen.add(String(p.characterId));
    participantsByInstitution.set(p.targetInstitutionId, seen);
  }
  /**
   * The ceiling to SHOW for an institution.
   *
   * Floored at one participant. An untouched institution has a crowd of zero
   * and therefore a true ceiling of zero, which on a meter reads as "the floor
   * can never move this" — the opposite of the truth. One participant is what
   * the first person to act would earn, so that is the honest thing to quote
   * before anyone has.
   *
   * Resolution is unaffected: `resolvePlayBatch` sizes the real pool from the
   * real count, and an institution with no plays has nothing to apportion.
   */
  const capForInstitution = (id: string) =>
    personalNetCapFor(Math.max(1, participantsByInstitution.get(id)?.size ?? 0));

  // PROJECTED, not read off the stamps.
  //
  // `appliedPoints` is null until the settlement phase resolves the turn, so
  // summing it reported the live turn as "scaled to +0.0" every time and made
  // the panel claim a scaling that had not happened. The board reports what the
  // tick WILL enforce; the wire is the side that reports what was already
  // written.
  //
  // Reading stamps where they exist would be no more accurate: the resolver
  // makes them sum to exactly the figure this projection computes, so the two
  // agree on every batch the resolver actually produced. They diverge only on
  // rows whose stamps could not have come from it.
  //
  // Run THROUGH THE RESOLVER, never a second copy of the apportionment, so the
  // panel, the institution cards and the turn phase cannot disagree. A local
  // clamp would be a second copy and would miss the largest-remainder split.
  const projected = resolvePlayBatch(personal);
  const byId = new Map(personal.map((p) => [String(p._id), p]));
  const netByInstitution = new Map<string, number>();
  for (const stamp of projected.stamped) {
    const institutionId = byId.get(String(stamp.id))?.targetInstitutionId;
    if (!institutionId) continue;
    netByInstitution.set(
      institutionId,
      (netByInstitution.get(institutionId) ?? 0) + stamp.appliedPoints
    );
  }
  /** What the tier moves on one institution, after that institution's ceiling. */
  const personalNetFor = (institutionId: string): number =>
    netByInstitution.get(institutionId) ?? 0;

  const openFloor = {
    characters: new Set(personal.map((p) => String(p.characterId))).size,
    netPoints: pts([...netByInstitution.values()].reduce((sum, v) => sum + v, 0)),
    rawPoints: pts(personalRawTotal),
    // The ceiling moves with turnout now, so report the largest one in play:
    // the institution a crowd is most likely to be pushing against.
    capPoints: magPts(Math.max(0, ...[...participantsByInstitution.keys()].map(capForInstitution))),
    capped: [...personalRawByInstitution.entries()].some(
      ([id, v]) => Math.abs(v) > capForInstitution(id)
    ),
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
  // The institutions a personal play can land on at all. Everywhere else the
  // cap never applies, so those cards carry no meter rather than one pinned
  // permanently at zero.
  const personalTargets = new Set(personalCatalogue.map((p) => p.target));

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

  // Counted from the rows already fetched for the open floor, so gating the
  // board costs no extra query. The command counts the same thing server-side;
  // this half exists so a spent play reads as closed rather than being refused
  // after the click.
  const usedByThisCharacter = new Map<string, number>();
  for (const p of personal) {
    if (String(p.characterId) !== String(characterId)) continue;
    usedByThisCharacter.set(p.playId, (usedByThisCharacter.get(p.playId) ?? 0) + 1);
  }

  const buildPlays = (institutionId: string | null): DossierPlayView[] => {
    const views: DossierPlayView[] = [];
    if (seat && seatDef && budget) {
      const balance = treasury?.treasuryBalance ?? 0;
      for (const play of catalogue.filter((p) => p.target === institutionId)) {
        const cash = canSeatAfford(play, budget);
        // THE canonical split, not a local subtraction. `treasuryBalance` is
        // signed, so `fundsCost - balance` counts pre-existing debt as newly
        // added: at a balance of -500M a 12M play reads as adding 512M. This is
        // the same function `spendFromTreasury` books the spend with, so the
        // number on the button is the number that lands.
        const { addedToDebt } = computeFiscalImpact(balance, play.fundsCost);
        const payments: DossierPaymentView[] = [
          {
            mode: "funds",
            label: "TREASURY",
            costLabel: costLabelFor(play, play.capitalCost, play.fundsCost, seat.id as CountryId),
            affordable: seat.canAct && cash.ok,
            blockedReason: seat.blockedReason ?? cash.reason ?? null,
            debtNote:
              addedToDebt > 0
                ? `adds ${formatLocalFunds(addedToDebt, COUNTRY_CURRENCY_MAP[seat.id as CountryId])} to the national debt`
                : null,
          },
        ];
        // Only a play the treasury actually pays for gets a second route. The
        // four capital-only plays would otherwise show two buttons for the same
        // thing, the second one dearer.
        if (play.fundsCost > 0) {
          const capitalCost = capitalPriceFor(play);
          // Priced through the SAME affordability rule as the cash route, so a
          // live button and the command can never disagree about what is
          // payable. `fundsCost: 0` is what makes the treasury irrelevant here.
          const alt = canSeatAfford({ ...play, capitalCost }, budget);
          payments.push({
            mode: "capital",
            label: "CAPITAL",
            costLabel: costLabelFor(play, capitalCost, 0, seat.id as CountryId),
            affordable: seat.canAct && alt.ok,
            blockedReason: seat.blockedReason ?? alt.reason ?? null,
            debtNote: null,
          });
        }
        views.push(
          playView({
            play,
            actor: "seat",
            multiplierPct: seatDef.multiplierPct,
            direction: seat.direction,
            multiplierLabel: `${(seatDef.multiplierPct / 100).toFixed(1)}× seat`,
            payments,
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
      // Named AHEAD of any money or action shortfall. A play already used this
      // turn is closed for a reason no amount of either fixes, and reporting a
      // funds shortfall instead would send a player off to solve the wrong
      // problem.
      const spent = (usedByThisCharacter.get(play.id) ?? 0) >= PERSONAL_PLAY_USES_PER_TURN;
      views.push(
        playView({
          play,
          actor: "personal",
          multiplierPct: PERSONAL_MULTIPLIER_PCT,
          // Personal plays choose their own side, so the board shows the
          // magnitude and the card offers the direction.
          direction: null,
          multiplierLabel: "0.25× personal",
          // One route only: a character has no seat capital pool, and the
          // command refuses capital mode on a personal play.
          payments: [
            {
              mode: "funds",
              label: "COMMIT",
              costLabel: costLabelFor(play, play.capitalCost, money?.local ?? play.fundsCost, null),
              affordable: !spent && check.ok,
              blockedReason: spent ? "used" : (check.reason ?? null),
              debtNote: null,
            },
          ],
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
    const personalRaw = personalRawByInstitution.get(inst.id) ?? 0;
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
      // At the cap exactly, nothing was scaled down but the institution is
      // already at its ceiling for the turn, so `maxed` reads >= where the
      // aggregate `openFloor.capped` (a throttle that BIT) stays strict.
      // The ceiling is THIS institution's, sized by the crowd pushing it, not a
      // constant shared across the board. Two cards can legitimately quote
      // different limits on the same turn.
      personalCap: personalTargets.has(inst.id)
        ? {
            rawPoints: magPts(personalRaw),
            netPoints: magPts(personalNetFor(inst.id)),
            capPoints: magPts(capForInstitution(inst.id)),
            maxed: Math.abs(personalRaw) >= capForInstitution(inst.id),
          }
        : null,
    };
  });

  // ── benches ───────────────────────────────────────────────────────────────
  const maxCommitted = Math.max(1, ...crisis.seats.map((s) => s.committedPoints));
  // Resolved once for all four seats rather than per bench row.
  const officesBySeat = await resolveSeatOffices(db);
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
      offices: officesBySeat[state.id] ?? [],
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
    opensAtTurn: ladderOpensAt,
    turnsUntilOpen: Math.max(0, ladderOpensAt - turn),
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
              treasuryLabel: treasuryLabelFor(treasury?.treasuryBalance ?? 0, seat.id as CountryId),
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
                ladderIsOpen &&
                crisis.ladder.heat === MAX_COERCIVE_RUNG,
              // Ordered PERMANENT TRUTH FIRST, then temporary. The switch being
              // off outranks everything because then nobody can escalate at
              // all. Lack of authority comes next: East Berlin will never hold
              // it, so telling that seat "the ladder opens on turn X" reads as
              // a promise the question can never keep. Only a seat that could
              // otherwise press today is told to wait for the clock.
              escalateGate: !rules.escalationEnabled
                ? "The escalation ladder is switched off for this question. Coercive plays still land; they simply leave no heat."
                : !seatDef.authority
                  ? escalateGateFor(seat.id)
                  : !ladderIsOpen
                    ? `The four-power channel is still sitting. The ladder opens on turn ${ladderOpensAt}` +
                      ` — ${ladderOpensAt - turn} turn${ladderOpensAt - turn === 1 ? "" : "s"} from now.`
                    : null,
            }
          : null,
      personalActions: ctx.personal.actionsRemaining,
    },
  };
}
