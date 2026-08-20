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

/** Index at or above which reunification carries, in hundredths. */
export const CARRY_THRESHOLD = 85 * HUNDREDTHS;
/** Index at or below which independence holds, in hundredths. */
export const LOCK_THRESHOLD = 15 * HUNDREDTHS;

/**
 * Mean-reversion strength, as a percent of the distance from anchor per turn.
 * 6 = 0.06. Integer so drift stays exact on the hundredths grid.
 *
 * Chosen so that sustained maximum Eastern effort plateaus above the carry
 * threshold while both sides playing optimally stalls below it — the stall is
 * the pressure that sends a bloc to the escalation ladder.
 */
export const DRIFT_K_PCT = 6;

/** Half-width of the undisclosed drift noise band, in hundredths. */
export const DRIFT_NOISE_SPAN = 3 * HUNDREDTHS;

/** Drift rolls retained for the rail's history strip. */
export const DRIFT_HISTORY_LENGTH = 6;

/**
 * Cap on the personal tier's NET contribution to one institution per turn, in
 * hundredths. Uncapped, thousands of characters at 0.25x would dominate every
 * national seat combined.
 */
export const PERSONAL_NET_CAP = 6 * HUNDREDTHS;

/** Highest rung coercive plays alone can reach. Rung 5 is a deliberate act. */
export const MAX_COERCIVE_RUNG = 4;

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
    magnitude: 8 * HUNDREDTHS,
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
    magnitude: 6 * HUNDREDTHS,
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
    magnitude: 5 * HUNDREDTHS,
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
    magnitude: 4 * HUNDREDTHS,
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
    magnitude: 4 * HUNDREDTHS,
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
    magnitude: 5 * HUNDREDTHS,
    capitalCost: 16,
    fundsUnit: "local",
    fundsCost: 0,
    actionCost: 2,
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
    magnitude: 5 * HUNDREDTHS,
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
    magnitude: 6 * HUNDREDTHS,
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
    magnitude: 5 * HUNDREDTHS,
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
    magnitude: 4 * HUNDREDTHS,
    capitalCost: 14,
    fundsUnit: "local",
    fundsCost: 15_000_000,
    actionCost: 2,
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
    magnitude: 4 * HUNDREDTHS,
    capitalCost: 0,
    fundsUnit: "local",
    fundsCost: 25_000_000,
    actionCost: 2,
    addsHeat: false,
    detail: "Two more brigades forward. Small in numbers, large in signal.",
  },
  {
    id: "fourpower",
    name: "Four-Power Note",
    seat: "UK",
    class: "diplomatic",
    target: "bundestag",
    magnitude: 3 * HUNDREDTHS,
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
    magnitude: 3 * HUNDREDTHS,
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
    magnitude: 150,
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
    magnitude: 2 * HUNDREDTHS,
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
    magnitude: 1 * HUNDREDTHS,
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
