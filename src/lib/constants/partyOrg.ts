/**
 * Party organization tunable constants (election cycles, decay).
 *
 * Lives under `src/lib/constants/` so UI, API routes, seeds, and turn logic share
 * one source of truth without importing from `src/lib/turn/` (see
 * `docs/engineering/architecture-boundaries.md`).
 */

/** Election cycle lengths in turns */
export const CYCLE_TURNS = {
  // US election types
  governor: 192,
  senate: 288,
  house: 96,
  stateSenate: 192,
  // UK election types (commons = 5 year term = 240 turns; regionalCouncil syncs with commons)
  commons: 240,
  regionalCouncil: 240,
  // JP election types (shugiin = 4 year term = 192; sangiin = 6 year term per class = 288)
  shugiin: 192,
  sangiin: 288,
  // DE election types (bundestag = 4 year term = 192; landtag = 5 year term = 240;
  // ministerPresident shares the landtag cycle — MP elections spawn paired
  // with each Land's Landtag election so timing matches RL practice where
  // the new majority appoints the MP after each state-parliament election)
  bundestag: 192,
  landtag: 240,
  ministerPresident: 240,
} as const;

// ─── Organization Building ────────────────────────────────────────────────────

/** Dollars required to gain +1 org per turn from org building */
export const DOLLARS_PER_ORG = 75000;

/**
 * Org decay per turn applied to every party row with Org > 0.
 *
 * 0.03125 pp / turn (1 turn = 1 real-time hour) ≈ 0.75 pp / IRL day or
 * 1.5 pp / game-year (48 turns). Quartered from the prior 0.125 pp / turn
 * after playtest feedback that the old rate forced players to click Build Org
 * too often just to tread water. At 0.03125 a player has ~8 IRL days of grace
 * between defensive clicks before a party in a neutral state visibly bleeds.
 *
 * Decayed Org returns implicitly to the state's Unaffiliated pool
 * (`Unaffiliated Org = 100 − Σ partyOrg`, derived).
 */
export const ORG_DECAY_RATE = 0.03125;

/**
 * Floor below which passive Org decay will NOT push a state party that has
 * genuine regional PRESENCE (`hasPresence: true`). Matches the seed floor the
 * per-country org seeders use (e.g. ukStatePartyOrgCalculations `MIN_ORG = 5`).
 *
 * Decay is the ONLY turn-pipeline Org mover (growth is player-click-only via
 * /build-org), so in an all-NPP world a present party's Org bleeds to 0 and it
 * is permanently locked out of every race there (Org 0 → ~0 vote weight). The
 * seed-disadvantaged major party (e.g. 1953 Republicans, seeded ~16) hits 0
 * first, producing runaway one-party blowouts. With this floor, present parties
 * bleed down to a viable minimum and stay contestable; parties WITHOUT presence
 * still decay to 0 (a dead party should release its Org to the Unaffiliated pool).
 */
export const MIN_PRESENCE_ORG = 5;

// ─── Default Tax Rates ─────────────────────────────────────────────────────────

/**
 * Default state party tax rate (%) when no players are in the state/party.
 * Allows NPPs to still contribute to party treasury even in unoccupied regions.
 */
export const DEFAULT_NPP_STATE_TAX_RATE = 5;

// —— Caucus NPP Recruitment ———————————————————————————————————————————————————————————————

/** Minimum chair↔NPP relationship required to recruit an NPP into a caucus. */
export const CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP = 60;

/**
 * Cooldown between successful caucus NPP recruitments. Resolved turn-first
 * (`CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS`) so it freezes on pause; the `_MS` value
 * is the wall-clock fallback for memberships that pre-date `joinedAtTurn`.
 */
export const CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS = 12; // 12 turns = 12h at standard cadence
export const CAUCUS_NPP_RECRUIT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/**
 * Relationship floor to remain in a caucus after the per-turn upkeep pass.
 * It is intentionally far lower than the recruit threshold so caucus
 * membership is meaningfully harder to earn than it is to maintain.
 */
export const CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP = 20;

/**
 * NPP relationships drift back toward neutral over time so one-off meetings do
 * not permanently lock in access to Slate, caucus recruitment, and influence.
 */
export const NPP_RELATIONSHIP_DECAY_PER_TURN = 0.1;
