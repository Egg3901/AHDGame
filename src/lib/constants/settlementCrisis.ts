/**
 * The German Question's fixed content: institutions, seats, and the play
 * catalogue.
 *
 * Client-safe: no db imports. Importing `src/lib/db/*` here drags `mongodb`
 * into the browser bundle and breaks `next build` — a failure neither typecheck
 * nor vitest can see.
 *
 * EVERYTHING POSITIONAL IS IN HUNDREDTHS. `HUNDREDTHS` is the conversion, so a
 * literal reads as `43 * HUNDREDTHS` rather than as an opaque 4300.
 */

/** Hundredths per point. All positions, magnitudes and thresholds use this grid. */
export const HUNDREDTHS = 100;

/**
 * How much slower the crisis runs than the source mockup's numbers imply.
 *
 * The board is a first-order system: every play adds a constant push P per
 * turn, drift pulls back by k x (distance from anchor), and the index settles
 * at `anchor + P/k` with a time constant of `1/k` turns. That means the pace
 * and the destination are set by DIFFERENT things — P/k fixes where it ends up,
 * 1/k fixes how long it takes to get there. Scaling P and k TOGETHER therefore
 * dilates time and leaves every balance property untouched: same equilibrium,
 * same relative worth of every play, same winner, just slower.
 *
 * At tempo 1 the mockup's magnitudes resolved an unopposed question in 35-43
 * turns — under a real day, when a turn is an hour. The brief is at least three
 * in-game years unopposed, and a contested question should run for real-world
 * days. At 48 turns to the year, three years is 144 turns, and 8 is the lowest
 * whole tempo that clears it on the FASTER of the two unopposed bounds:
 * independence locks at 156 turns, reunification carries at 294. So:
 *
 *   - every authored magnitude below is written `mag(<mockup points>)`
 *   - `DRIFT_K_BPS`, `DRIFT_NOISE_SPAN` and `PERSONAL_NET_CAP` divide by it too
 *
 * Change this one number to retune the whole clock. Changing a magnitude
 * WITHOUT changing the brake changes where the crisis lands, not how long it
 * takes — that is the balance dial, and this is the speed dial.
 */
export const SETTLEMENT_TEMPO = 8;

/**
 * An authored magnitude in mockup points, converted to a tempo-scaled hundredth.
 *
 * Rounds to the hundredths grid so the integer arithmetic downstream stays
 * exact. Sub-point results are intended: at this tempo a single play is worth
 * a fraction of an index point, and the crisis is the sum of hundreds of them.
 */
export function mag(points: number): number {
  return Math.round((points * HUNDREDTHS) / SETTLEMENT_TEMPO);
}

export type SettlementInstitutionKey = "bundestag" | "laender" | "street" | "garrison";
export type SettlementSeatKey = "US" | "UK" | "RU" | "DD";

export interface SettlementInstitutionDef {
  id: SettlementInstitutionKey;
  name: string;
  /** Static flavour only. Live subtitles are composed by the read model. */
  flavour: string;
  weight: number;
  /** Opening position in hundredths toward the challenger. */
  opening: number;
  /** Where Bonn's own politics pull this institution back to, in hundredths. */
  anchor: number;
}

export interface SettlementSeatDef {
  id: SettlementSeatKey;
  name: string;
  countryId: string;
  tier: "primary" | "secondary";
  /** Percent multiplier: 200 = 2.0x. Integer so the arithmetic stays exact. */
  multiplierPct: number;
  /** Seat action points granted per turn. */
  actionsPerTurn: number;
  /** Capital granted per turn, whole points. */
  capitalPerTurn: number;
  /** Display label for this seat's capital pool. */
  capitalLabel: string;
  /**
   * How the news wire names this delegation — the CAPITAL, not the seat id.
   * The source design's wire reads "EAST BERLIN opens the inner border", not
   * "DD opens the inner border".
   */
  wireLabel: string;
  /** May arm the ladder and declare. Washington and Moscow only. */
  authority: boolean;
}

export interface SettlementPlayDef {
  id: string;
  name: string;
  /** Seat this play belongs to; null means the personal catalogue. */
  seat: SettlementSeatKey | null;
  class: "exclusive" | "diplomatic" | "spend" | "coercive" | "forces" | "personal";
  /** Institution targeted, or null to move the settlement index directly. */
  target: SettlementInstitutionKey | null;
  /** UNSIGNED magnitude in hundredths. Sign comes from the actor's direction. */
  magnitude: number;
  /** Whole capital points. */
  capitalCost: number;
  /**
   * Which currency `fundsCost` is denominated in.
   *
   * `local` — the seat country's own currency. The authored seat costs are
   * literal mockup figures (ℳ12M, $60M, £25M) and mean exactly what they say.
   *
   * `anchor` — converted at the actor's home FX rate before it is charged.
   * Personal plays use this so a character pays the same real value wherever
   * they live; a flat local figure would make `rally` roughly four times
   * cheaper in Moscow than in Washington at 1953 rates. Matches how
   * `applyEffectToCharacter` and `influence/executor` already treat a
   * character's `fundsChange`.
   */
  fundsUnit: "local" | "anchor";
  /** Funds cost in the unit named by `fundsUnit`. Zero for a free play. */
  fundsCost: number;
  actionCost: number;
  /** Coercive plays add a rung of ladder heat. */
  addsHeat: boolean;
  detail: string;
}

/** The personal multiplier, for characters acting on their own account. */
export const PERSONAL_MULTIPLIER_PCT = 25;

/** Max banked capital for any seat. */
export const SEAT_CAPITAL_CAP = 60;

/**
 * How many turns' worth of action points a seat may bank.
 *
 * Banking exists so a secondary can save for a play that costs more AP than it
 * earns; three turns is enough for the most expensive of those (2 AP) with one
 * to spare. A ceiling at all is what stops a seat sitting out fifty turns and
 * then emptying its whole catalogue into a single tick.
 */
export const SEAT_ACTION_BANK_TURNS = 3;

/** The AP ceiling for one seat, derived from its per-turn grant. */
export function seatActionBankCap(actionsPerTurn: number): number {
  return actionsPerTurn * SEAT_ACTION_BANK_TURNS;
}

/** Index at or above which reunification carries, in hundredths. */
export const CARRY_THRESHOLD = 85 * HUNDREDTHS;
/** Index at or below which independence holds, in hundredths. */
export const LOCK_THRESHOLD = 15 * HUNDREDTHS;

/**
 * Mean-reversion strength per turn, in BASIS POINTS of the distance from
 * anchor. 75 = 0.75%. Basis points rather than percent because the tempo
 * divisor leaves no resolution in a whole percent.
 *
 * TUNED AGAINST MEASUREMENT, NOT INTUITION. The authored 0.06 was chosen so
 * that maximum Eastern effort would plateau above the carry threshold. It does
 * not: `scripts/debug/gq-balance-sim.ts`, driving these same modules, plateaus
 * the best sustainable Eastern case at 73.5 against a threshold of 85, so
 * reunification is unreachable by play and the West wins every game it bothers
 * to contest. The brake, not the catalogue, is the cause — repricing the plays
 * and doubling secondary AP were both measured and both failed, because
 * reversion scales with the distance already travelled and swallows any
 * constant push at 0.06.
 *
 * DERIVED from `SETTLEMENT_TEMPO` rather than written out, because the two must
 * move together or the equilibrium moves with them: slowing the plays alone
 * would put both thresholds out of reach, and this whole file's magnitudes are
 * tempo-scaled. The numerator is therefore the BALANCE dial (it fixes where the
 * index settles) and the tempo is the SPEED dial (it fixes how long the board
 * takes to get there). A tempo change alone is provably balance-neutral.
 *
 * 200, down from the 300 that was measured at tempo 1, because the two
 * unopposed bounds are asymmetric by the board's own geometry: the opening
 * index of 38.2 is 23.2 points from the lock and 46.8 from the carry, so an
 * unopposed East always takes about twice as long as an unopposed West. At 300
 * the far bound stretched to seven in-game years for a question nobody was
 * contesting, while the near one barely moved. Slackening the brake pulls the
 * far bound in hard and leaves the CONTESTED stall alone — it measured 57.3 at
 * 300 and 57.5 at 200, still unresolved after 480 turns either way. See
 * `ahd-german-question-balance-findings` for the measured sweep.
 */
export const DRIFT_K_BPS = Math.round(200 / SETTLEMENT_TEMPO);

/** Half-width of the undisclosed drift noise band, in hundredths. */
export const DRIFT_NOISE_SPAN = mag(3);

/** Drift rolls retained for the rail's history strip. */
export const DRIFT_HISTORY_LENGTH = 6;

/**
 * Cap on the personal tier's NET contribution to one institution per turn, in
 * hundredths. Uncapped, thousands of characters at 0.25x would dominate every
 * national seat combined.
 *
 * Tempo-scaled with the rest, so the public tier keeps the same share of the
 * board as the seats no matter how slowly the crisis is set to run.
 */
export const PERSONAL_NET_CAP = mag(6);

/** Highest rung coercive plays alone can reach. Rung 5 is a deliberate act. */
export const MAX_COERCIVE_RUNG = 4;

/**
 * How long the four-power channel runs before the brink is available at all.
 *
 * Two in-game years at 48 turns to the year. MEASURED, NOT GUESSED: without
 * this, `scripts/debug/gq-war-path-sim.ts` has Moscow standing at the coercive
 * cap on turn 3, arming on turn 4 and declaring on turn 4 — of a settlement
 * game tuned to run 149 to 257 turns. Nothing in `declareSettlementWar` gates
 * on the index or on the age of the question, so the whole political board was
 * optional: one authority seat could end an admin-opened set piece within four
 * hours, before the other three delegations had logged in.
 *
 * The design's own logic is that the STALL is what sends a bloc to the ladder —
 * war is the tiebreak when politics deadlocks. This makes that literal. A plain
 * age gate rather than a cleverer deadlock test, because the player has to
 * understand why the button is greyed out, and "the four-power channel runs
 * until turn X" reads at a glance where "the index has been inside a band for
 * N turns" does not.
 *
 * Heat still ACCUMULATES from turn one — the ladder climbs, the DEFCON display
 * lives, the tension is legible. Only the press is held back.
 */
export const LADDER_UNLOCK_TURNS = 96;

/**
 * Consecutive quiet turns that cost the ladder a rung.
 *
 * The authored law decayed a rung on EVERY turn without a coercive play, which
 * sets a hidden threshold nobody intended: a bloc has to land coercion on more
 * than half of all turns simply to stay where it is, or the ladder walks back
 * down faster than it climbs. Measured against the real catalogue, no bloc
 * clears 50% for long — East Berlin's `border` costs money and its treasury is
 * spent by about turn 60 — so heat collapsed to zero and the brink became
 * unreachable rather than expensive.
 *
 * It also meant rung 5 could not be HELD, which is the opposite of the design's
 * stated intent that the brink is "a position you pay to maintain rather than a
 * state you reach". The standoff — both sides mobilised, DEFCON 1, somebody has
 * to blink — lasted a single turn, and the mobilisation levy built to make it
 * expensive was never charged long enough to bite.
 *
 * One counter governs every rung rather than special-casing the top one: three
 * quiet turns cost a rung, so holding any position needs coercion one turn in
 * three. Both blocs clear that once their authority seats' plays are priced to
 * be affordable, and the levy compounds over a standoff long enough to hurt.
 */
export const LADDER_DECAY_TURNS = 3;

/**
 * What one turn at the top of the ladder costs each delegation's country.
 *
 * Rung 5 is DEFCON 1 — mobilised armies, closed corridors, a market that has
 * priced in a war. Without a standing cost a bloc could arm and simply sit
 * there, which turns the brink into a free threat and the ladder into a latch.
 * Paired with heat decay, holding the top rung becomes a position you pay to
 * maintain rather than a state you reach.
 *
 * Charged as a share of the country's own treasury rather than a flat sum, so
 * it bites Washington and East Berlin proportionally instead of bankrupting the
 * poorest seat first.
 */
export const MOBILISATION_TREASURY_SHARE = 0.02;
/** Approval points each seat country loses per turn while armed. */
export const MOBILISATION_APPROVAL_HIT = 1;

/**
 * The turn from which a settled question is considered fair to ask again.
 *
 * It GATES NOTHING. Opening is admin-started and unconditional on timing, so
 * this is advice written onto the resolved document and shown in the admin
 * history, not a lock. The field it lands in carries the load: a resolved
 * crisis with a null `cooldownUntilTurn` is one the actuation sweep has not
 * enacted yet, and that IS a refusal to reopen.
 *
 * Three in-game years at 48 turns to the year, matching the shortest a question
 * takes to answer: the old 96 dated from a tempo at which the whole crisis ran
 * in under one, and advising "fair to ask again in two years" about something
 * that takes three to settle reads as a mistake.
 */
export const SETTLEMENT_REOPEN_COOLDOWN_TURNS = 144;

/**
 * Turns between sentiment briefings on the World News wire.
 *
 * The public tier is one row per character who acted, so a post per action
 * would bury the channel. The interval has to be long enough that a briefing
 * has a swing worth reporting and short enough that a crisis never goes quiet.
 *
 * Twelve, up from the design's six, because the crisis now runs 149-480 turns
 * rather than the 43 it ran when six was chosen: at six that is 25-80 dispatches
 * on one channel, about four a day. Twice a day still narrates a question that
 * takes a real week to answer.
 */
export const SETTLEMENT_WIRE_INTERVAL_TURNS = 12;

/** The interval the design's swing vocabulary was authored against. */
const AUTHORED_WIRE_INTERVAL_TURNS = 6;

/**
 * A threshold in POINTS for the prose that describes a swing.
 *
 * The wire's vocabulary — "edged", "moved", "swung sharply" — is banded in
 * index points measured BETWEEN DISPATCHES, so it has to track two things at
 * once. Tempo divides it, because tempo is what divides an index point. The
 * dispatch interval multiplies it, because waiting twice as long accumulates
 * twice the swing.
 *
 * Left unscaled the vocabulary collapses to one word. At the tuned tempo the
 * fastest unopposed pace is about 2 points per twelve-turn interval; against the
 * authored 3.0 that meant "moved" and 8.0 that meant "swung sharply", every
 * dispatch in the game would read "barely moved".
 */
export function swingBand(points: number): number {
  return (
    (points * SETTLEMENT_WIRE_INTERVAL_TURNS) / (AUTHORED_WIRE_INTERVAL_TURNS * SETTLEMENT_TEMPO)
  );
}

/** The document `kind`, and the only settlement question that exists today. */
export const GERMAN_QUESTION_KIND = "settlement.germanQuestion" as const;

/** Whose settlement is at stake, and who would absorb them. */
export const GERMAN_QUESTION_TARGET = "DE";
export const GERMAN_QUESTION_CHALLENGER = "DD";

/**
 * The three rule switches the source design declares under its "Rules" section.
 *
 * They are stored PER CRISIS rather than on `gameState`. Two of the three
 * default ON, and the feature-gates panel reads every boolean fail-closed
 * (`=== true`), so a missing field there would silently mean "off" and invert
 * both of them. A crisis-scoped block also lets an admin run one question with
 * the band revealed without changing the rules of the next one.
 *
 * The mockup declares the props and never consumes them, so the meanings below
 * are the design doc's (§12), fixed here rather than left to each reader:
 *
 * - `openLog` — the wire is a PUBLIC log. Off, it carries only resolved lines,
 *   so no delegation can read what the others committed before the tick.
 * - `driftRevealed` — publishes Bonn's noise band. Off, the roll is disclosed
 *   only after it lands.
 * - `escalationEnabled` — the ladder is in play. Off, coercive plays add no
 *   heat and the crisis cannot be armed or declared.
 */
export interface SettlementRules {
  openLog: boolean;
  driftRevealed: boolean;
  escalationEnabled: boolean;
}

export const SETTLEMENT_DEFAULT_RULES: SettlementRules = {
  openLog: true,
  driftRevealed: false,
  escalationEnabled: true,
};

export type SettlementRuleKey = keyof SettlementRules;

export const SETTLEMENT_RULE_KEYS: readonly SettlementRuleKey[] = [
  "openLog",
  "driftRevealed",
  "escalationEnabled",
];

/**
 * A crisis's rules, tolerating a document written before the field existed.
 *
 * Falls back per key, not wholesale: a partially written block from an admin
 * `$set` must not discard the other two switches.
 */
export function settlementRulesFor(crisis: {
  rules?: Partial<SettlementRules> | null;
}): SettlementRules {
  return { ...SETTLEMENT_DEFAULT_RULES, ...(crisis.rules ?? {}) };
}

/** The disclosed band, when `driftRevealed` is on. Points, not hundredths. */
export function driftBandLabel(): string {
  const span = DRIFT_NOISE_SPAN / HUNDREDTHS;
  return `−${span.toFixed(2)} to +${span.toFixed(2)} noise · ${(DRIFT_K_BPS / 100).toFixed(2)}% reversion`;
}

export const LADDER_RUNGS: readonly string[] = [
  "Diplomatic notes · four-power channel",
  "Border incidents · troop alerts",
  "Transit quarantine · garrison reinforcement",
  "Full mobilization on the Elbe",
  "Nuclear alert · DEFCON 1",
];

export const SETTLEMENT_INSTITUTIONS: readonly SettlementInstitutionDef[] = [
  {
    id: "bundestag",
    name: "Bundestag Opinion",
    flavour: "Bonn",
    weight: 3,
    opening: 43 * HUNDREDTHS,
    anchor: 40 * HUNDREDTHS,
  },
  {
    id: "laender",
    name: "The Länder",
    flavour: "Bundesrat bloc",
    weight: 2,
    opening: 37 * HUNDREDTHS,
    anchor: 35 * HUNDREDTHS,
  },
  {
    id: "street",
    name: "The Street",
    flavour: "Demonstrations · union halls · student left",
    weight: 2,
    opening: 61 * HUNDREDTHS,
    anchor: 56 * HUNDREDTHS,
  },
  {
    id: "garrison",
    name: "Allied Garrison",
    flavour: "US/UK/FR forces · Berlin brigades · transit",
    weight: 3,
    opening: 19 * HUNDREDTHS,
    anchor: 16 * HUNDREDTHS,
  },
];

export const TOTAL_INSTITUTION_WEIGHT = 10;

export const SETTLEMENT_SEATS: readonly SettlementSeatDef[] = [
  {
    id: "DD",
    name: "GDR · Staatsrat",
    countryId: "DD",
    tier: "primary",
    multiplierPct: 200,
    actionsPerTurn: 3,
    capitalPerTurn: 6,
    capitalLabel: "Party Capital",
    wireLabel: "EAST BERLIN",
    authority: false,
  },
  {
    id: "RU",
    name: "USSR · Politburo",
    countryId: "RU",
    tier: "secondary",
    multiplierPct: 100,
    actionsPerTurn: 1,
    capitalPerTurn: 3,
    capitalLabel: "Party Capital",
    wireLabel: "MOSCOW",
    authority: true,
  },
  {
    id: "US",
    name: "United States · NSC",
    countryId: "US",
    tier: "secondary",
    multiplierPct: 100,
    actionsPerTurn: 1,
    capitalPerTurn: 3,
    capitalLabel: "Political Capital",
    wireLabel: "WASHINGTON",
    authority: true,
  },
  {
    id: "UK",
    name: "United Kingdom · FCO",
    countryId: "UK",
    tier: "secondary",
    multiplierPct: 100,
    actionsPerTurn: 1,
    capitalPerTurn: 3,
    capitalLabel: "Political Capital",
    wireLabel: "LONDON",
    authority: false,
  },
];

export const SETTLEMENT_PLAYS: readonly SettlementPlayDef[] = [
  // ── GDR · Staatsrat ────────────────────────────────────────────────────────
  {
    id: "border",
    name: "Open the Inner Border",
    seat: "DD",
    class: "exclusive",
    target: "street",
    magnitude: mag(8),
    capitalCost: 14,
    fundsUnit: "local",
    fundsCost: 12_000_000,
    actionCost: 2,
    addsHeat: true,
    detail:
      "Let families cross for a weekend. Nothing moves the street like it — and nothing is harder to walk back.",
  },
  {
    id: "terms",
    name: "Table Reunification Terms",
    seat: "DD",
    class: "exclusive",
    target: "bundestag",
    magnitude: mag(6),
    capitalCost: 18,
    fundsUnit: "local",
    fundsCost: 0,
    actionCost: 3,
    addsHeat: false,
    detail:
      "A written offer to Bonn: one Germany, one currency, no NATO. Forces the Bundestag to answer.",
  },
  {
    id: "referendum",
    name: "Call a Joint Referendum",
    seat: "DD",
    class: "exclusive",
    target: null,
    /*
     * 2.5, not the mockup's 5.0, because a SETTLEMENT-level magnitude is not
     * in the same unit as an institution one. Adding d to all four moves the
     * weighted mean by exactly d, so 5.0 x 2.0 was worth 10.0 index points
     * against `border`'s 8.0 x 2.0 on a weight-2 institution = 3.2. That is
     * 3.33 index per action point against a catalogue median of 0.9, and it
     * decided every simulated crisis on its own: with a seat that saves its
     * capital for it, reunification carried in 18-25 turns in EVERY scenario,
     * contested or not. At 2.5 it is worth 5.0 index — a shade above `border`,
     * which is right for the priciest play on the board and the only one no
     * single institution can block.
     */
    magnitude: mag(2.5),
    capitalCost: 22,
    fundsUnit: "local",
    fundsCost: 30_000_000,
    actionCost: 3,
    addsHeat: true,
    detail:
      "Put it to both Germanies at once. Moves the settlement directly — and the Allies will read it as a coup attempt.",
  },
  {
    id: "aid",
    name: "Fraternal Aid Package",
    seat: "DD",
    class: "spend",
    target: "laender",
    magnitude: mag(4),
    capitalCost: 0,
    fundsUnit: "local",
    fundsCost: 45_000_000,
    actionCost: 1,
    addsHeat: false,
    detail:
      "Coal, steel and cheap credit into the border Länder. Buys quiet sympathy in state capitals.",
  },
  // ── USSR · Politburo ───────────────────────────────────────────────────────
  {
    id: "ostpolitik",
    name: "Ostpolitik Overture",
    seat: "RU",
    class: "diplomatic",
    target: "bundestag",
    magnitude: mag(4),
    capitalCost: 12,
    fundsUnit: "local",
    fundsCost: 20_000_000,
    actionCost: 2,
    addsHeat: false,
    detail: "Offer Bonn trade and a Berlin guarantee in exchange for neutrality talks.",
  },
  {
    // Id deliberately NOT `garrison`: that is an institution id, and the
    // collision would make target routing ambiguous. Display name unchanged.
    id: "pressure",
    name: "Pressure the Garrison",
    seat: "RU",
    class: "coercive",
    target: "garrison",
    /*
     * HALVED alongside the cost below, so the reprice buys escalation and not
     * settlement. Landing twice as often at half the magnitude leaves this
     * play's contribution to the INDEX exactly where the design put it, while
     * letting it feed the ladder. Without the halving the two repricings alone
     * pulled the unopposed lock from 156 turns to 116 — under the three
     * in-game-year floor — and shoved the contested stall from 57.5 to 65.
     */
    magnitude: mag(2.5),
    /*
     * 1 AP and 8 capital, down from 2 and 16, for the same reason `station`
     * was repriced and measured the same way: AN AUTHORITY SEAT MUST BE ABLE
     * TO FEED THE LADDER IT CAN ARM. Moscow earns 1 AP and 3 capital a turn, so
     * at the authored price this landed once every 5.3 turns — and it is the
     * East's only coercive play that costs no money. East Berlin's is `border`
     * at ℳ12M against a ℳ310M treasury, which runs dry around turn 60, so past
     * that point the whole Eastern ladder rested on this one play at 19%
     * density against a rung that decays every quiet turn. Measured, the East
     * could not climb back to the coercive cap at all once the opening capital
     * banks were spent.
     *
     * Still dearer than `station`: this is a weight-3 institution at a larger
     * magnitude, so Moscow pays more per press than Washington does.
     */
    capitalCost: 8,
    fundsUnit: "local",
    fundsCost: 0,
    actionCost: 1,
    addsHeat: true,
    detail:
      "Harass the transit corridors. Makes the Allied presence look expensive and precarious.",
  },
  {
    id: "peace",
    name: "Fund the Peace Movement",
    seat: "RU",
    class: "spend",
    target: "street",
    magnitude: mag(5),
    capitalCost: 0,
    fundsUnit: "local",
    fundsCost: 35_000_000,
    actionCost: 1,
    addsHeat: false,
    detail: "Money through front organisations into the anti-missile campaign.",
  },
  // ── United States · NSC ────────────────────────────────────────────────────
  {
    id: "article5",
    name: "Reaffirm Article 5",
    seat: "US",
    class: "diplomatic",
    target: "garrison",
    magnitude: mag(6),
    capitalCost: 10,
    fundsUnit: "local",
    fundsCost: 0,
    actionCost: 2,
    addsHeat: false,
    detail:
      "A presidential guarantee in writing, read aloud in Berlin. Steadies the garrison question.",
  },
  {
    id: "credit",
    name: "Marshall-Scale Credit Line",
    seat: "US",
    class: "spend",
    target: "laender",
    magnitude: mag(5),
    capitalCost: 0,
    fundsUnit: "local",
    fundsCost: 60_000_000,
    actionCost: 1,
    addsHeat: false,
    detail:
      "Dollars into state industry. State premiers who owe you do not vote for reunification.",
  },
  {
    id: "station",
    name: "Station: Counter-Press",
    seat: "US",
    class: "coercive",
    target: "street",
    /* Halved with the cost, for the reason given on `pressure`. */
    magnitude: mag(2),
    /*
     * 1 AP and 6 capital, down from 2 and 14, because this is the WEST'S ONLY
     * COERCIVE PLAY and at the authored price the West could not reach the
     * escalation ladder at all. Washington earns 1 AP and 3 capital a turn, so
     * a 2 AP / 14 capital play lands once every 4.7 turns against a ladder that
     * decays every quiet turn: measured, Western heat oscillates between 0 and
     * 1 forever, and London has no coercive play whatsoever. Washington holds
     * authority to arm and could never satisfy the precondition — an arming
     * control that is permanently inert, and no way to answer an Eastern
     * escalation or to deter one.
     *
     * At this price it lands every other turn, inside LADDER_DECAY_TURNS,
     * so NATO can both reach the brink and hold it. Still the cheapest thing on
     * the board by index — it buys escalation, not settlement.
     */
    capitalCost: 6,
    fundsUnit: "local",
    fundsCost: 15_000_000,
    actionCost: 1,
    addsHeat: true,
    detail:
      "Place editorials, fund rival unions, expose the fronts. Effective — until it is exposed.",
  },
  // ── United Kingdom · FCO ───────────────────────────────────────────────────
  {
    id: "rhine",
    name: "Rhine Army Reinforcement",
    seat: "UK",
    class: "forces",
    target: "garrison",
    magnitude: mag(4),
    capitalCost: 0,
    fundsUnit: "local",
    fundsCost: 25_000_000,
    actionCost: 1,
    addsHeat: false,
    detail: "Two more brigades forward. Small in numbers, large in signal.",
  },
  {
    id: "fourpower",
    name: "Four-Power Note",
    seat: "UK",
    class: "diplomatic",
    target: "bundestag",
    magnitude: mag(3),
    capitalCost: 8,
    fundsUnit: "local",
    fundsCost: 0,
    actionCost: 1,
    addsHeat: false,
    detail: "Remind Bonn that the occupying powers, not the Volkskammer, hold the final say.",
  },
  {
    id: "broadcast",
    name: "Broadcast Into the East",
    seat: "UK",
    class: "spend",
    target: "street",
    magnitude: mag(3),
    capitalCost: 0,
    fundsUnit: "local",
    fundsCost: 10_000_000,
    actionCost: 1,
    addsHeat: false,
    detail: "BFBS and Deutsche Welle at full power. Cheap, deniable, slow.",
  },
  // ── Personal — any character, direction chosen freely ──────────────────────
  {
    id: "oped",
    name: "Publish an Op-Ed",
    seat: null,
    class: "personal",
    target: "street",
    magnitude: mag(1.5),
    capitalCost: 0,
    fundsUnit: "anchor",
    fundsCost: 0,
    actionCost: 1,
    addsHeat: false,
    detail:
      "Any character with a byline can move the street a little. Thousands of them move it a lot.",
  },
  {
    id: "rally",
    name: "Rally Your Constituency",
    seat: null,
    class: "personal",
    target: "street",
    magnitude: mag(2),
    capitalCost: 0,
    fundsUnit: "anchor",
    fundsCost: 5_000,
    actionCost: 2,
    addsHeat: false,
    detail: "Turn out your own voters for or against. Costs money and a full turn.",
  },
  {
    id: "letter",
    name: "Sign the Open Letter",
    seat: null,
    class: "personal",
    target: "bundestag",
    magnitude: mag(1),
    capitalCost: 0,
    fundsUnit: "anchor",
    fundsCost: 0,
    actionCost: 1,
    addsHeat: false,
    detail:
      "Add your name to the deputies' letter. One signature is noise; a caucus is a headline.",
  },
];

export function getInstitution(id: string): SettlementInstitutionDef | undefined {
  return SETTLEMENT_INSTITUTIONS.find((i) => i.id === id);
}

export function getSeat(id: string): SettlementSeatDef | undefined {
  return SETTLEMENT_SEATS.find((s) => s.id === id);
}

export function getPlay(id: string): SettlementPlayDef | undefined {
  return SETTLEMENT_PLAYS.find((p) => p.id === id);
}

/** Plays available to a seat, or the personal catalogue when `seat` is null. */
export function playsForSeat(seat: SettlementSeatKey | null): SettlementPlayDef[] {
  return SETTLEMENT_PLAYS.filter((p) => p.seat === seat);
}
