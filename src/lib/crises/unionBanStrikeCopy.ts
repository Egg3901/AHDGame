import type { CorporationType } from "@/lib/constants/corporations";

/**
 * Shared constants and copy for the union-ban wildcat general strike.
 *
 * Kept in its own module so the three files that need them can all import from
 * here without a cycle: `templates.ts` (which authors the crisis), the wire desk
 * (which writes about it) and `unionBanStrike.ts` (which runs it, and imports
 * both of the others).
 */

/** `ALL_CRISIS_TEMPLATES` key for the wildcat general strike. */
export const UNION_BAN_STRIKE_TEMPLATE_KEY = "union_ban_general_strike";

/**
 * Hard cap on the strike, in turns. The workers cannot stay out forever: with
 * no resolution the crisis expires on the ordinary crisis-turn path and the
 * effects unwind with it. 24 is also `MIN_CRISIS_DURATION_TURNS`, so the floor
 * in `floorCrisisDuration` leaves it exactly where it is authored.
 */
export const UNION_BAN_STRIKE_DURATION_TURNS = 24;

/**
 * Node ids in the strike's decision tree.
 *
 * Shared because two modules name them: `templates.ts` authors the tree, and
 * `unionBanStrike.ts` redirects to `settlement` or `alreadyOver` from inside an
 * action hook. A typo in either place would strand the interaction on a node
 * that does not exist, so both read the same constants.
 */
export const UNION_BAN_STRIKE_NODES = {
  response: "response",
  army: "terminal_army",
  settlement: "terminal_settlement",
  rideOut: "terminal_ride_it_out",
  backDown: "terminal_back_down",
  alreadyOver: "terminal_already_over",
} as const;

/**
 * The sectors that walk out.
 *
 * Steel has no sector type of its own and is produced by `manufacturing` (the
 * same mapping the steel strike uses). Ports/dockworkers and teamsters/freight
 * both live in `logistics`, so one entry covers both. These are engine
 * identifiers, not copy: the country-facing names are in
 * {@link STRUCK_TRADE_COPY}.
 */
export const UNION_BAN_STRUCK_SECTORS: CorporationType[] = [
  "manufacturing",
  "automobiles",
  "logistics",
];

/** What the struck trades are called in each country. Falls back to `default`. */
export const STRUCK_TRADE_COPY: Record<string, string> = {
  default: "steelworkers, car plants, dockers and freight drivers",
  US: "steelworkers, auto plants, longshoremen and teamsters",
  UK: "steelworkers, car plants, dockers and lorry drivers",
  DE: "steelworkers, car plants, dockers and hauliers",
};

/** Struck-trade copy for a country. */
export function struckTradesFor(countryId: string): string {
  return STRUCK_TRADE_COPY[countryId] ?? STRUCK_TRADE_COPY.default;
}
