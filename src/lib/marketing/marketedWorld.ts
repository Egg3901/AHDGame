/**
 * THE SINGLE SOURCE OF TRUTH for every public claim about what this game is.
 *
 * THE PROBLEM THIS SOLVES. "Which countries can you play?" and "what version
 * is live?" were answered independently by seven surfaces, and every one of
 * them was hand-maintained prose. On 2026-09-06 they disagreed four ways at
 * once: the FAQ said four nations, the about page said US/UK/Japan, the landing
 * promo pill advertised v1.0.0 while 1.6.0 was in production, and the studio
 * site said twenty-one playable countries next to a banner claiming the world
 * was paused. Each fix was a one-line edit somewhere, which is exactly why the
 * copy rotted again a fortnight later.
 *
 * So no marketing surface is allowed to name a country or a version any more.
 * They ask here, and this module answers from live game state:
 *
 *   playable  = `countryGameStates.enabledForPlayers`, the same read the game
 *               itself uses to decide whether you may file for office. If a
 *               country opens or closes, the copy follows on the next request.
 *   economy   = the curated econ tier for the running era, minus anything that
 *               has since become playable.
 *   version   = `package.json`, which `npm run changelog:release` bumps as it
 *               mints a release. There is no second version string to forget.
 *
 * `publicCopy.test.ts` fails the build if a surface goes back to hardcoding.
 */
import {
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
  getCountryDisplayName,
  type CountryId,
} from "@/lib/constants/countries";
import { ERA_CONFIGS, type EraId } from "@/components/landing/eraThemes";
import pkg from "../../../package.json";

/** The live release, minted by `npm run changelog:release`. */
export const GAME_VERSION: string = pkg.version;

/**
 * Countries with an authored world behind them, playable or not. This is the
 * number the README and the API guide mean by "registered countries" — it is
 * NOT the playable count, and the two have been confused in public copy before.
 */
export const REGISTERED_COUNTRY_COUNT = COUNTRY_ORDER.length;

export interface MarketedNation {
  id: CountryId;
  /** Era-correct display name: "Soviet Union" in 1953, "Russia" in 1991. */
  name: string;
}

export interface MarketedWorld {
  version: string;
  /** Era key, e.g. "1953". */
  eraId: string;
  /** The year the running world was seeded from. */
  seedYear: number;
  /** Seed preset id, e.g. "1953-default". Drives era name overrides. */
  presetId: string;
  /** Countries a player can actually pick right now. */
  playable: MarketedNation[];
  /** Simulated and browsable, but not open to play. Curated, not exhaustive. */
  economy: MarketedNation[];
  registeredCountryCount: number;
}

export const DEFAULT_SEED_YEAR = 1979;

/** Era ids the landing configs know about, newest first for the fallback pick. */
export function toEraId(seedYear: number): EraId {
  const key = String(seedYear) as EraId;
  return key in ERA_CONFIGS ? key : (String(DEFAULT_SEED_YEAR) as EraId);
}

/**
 * Era roster for a seed year, split by marketing tier.
 *
 * `ERA_CONFIGS[era].nations` is already the curated public roster behind the
 * landing globe, and `countryTiers.test.ts` re-derives it from the world entity
 * manifest on every run, so it cannot silently rot. Reusing it here means the
 * globe and the prose can never name different countries.
 */
export function eraRoster(eraId: EraId): { player: CountryId[]; econ: CountryId[] } {
  const nations = ERA_CONFIGS[eraId].nations;
  const known = (id: string): id is CountryId => Object.hasOwn(COUNTRY_CONFIGS, id);
  return {
    player: nations.filter((n) => n.tier === "player" && known(n.id)).map((n) => n.id as CountryId),
    econ: nations.filter((n) => n.tier === "econ" && known(n.id)).map((n) => n.id as CountryId),
  };
}

export function toNations(ids: readonly CountryId[], presetId: string): MarketedNation[] {
  return ids.map((id) => ({ id, name: getCountryDisplayName(id, presetId) }));
}

/**
 * The answer without a database: the era roster as authored.
 *
 * Used by the paths that cannot await Mongo (module-scope JSON-LD, error
 * pages) and as the failure mode for the ones that can. The `player` tier has
 * been US/UK/RU/DD across every authored era, so this is wrong only in the
 * window between an admin opening a country and the next release.
 */
export function fallbackMarketedWorld(seedYear: number = DEFAULT_SEED_YEAR): MarketedWorld {
  const eraId = toEraId(seedYear);
  const presetId = `${eraId}-default`;
  const roster = eraRoster(eraId);
  const playableSet = new Set<CountryId>(roster.player);
  return {
    version: GAME_VERSION,
    eraId,
    seedYear,
    presetId,
    playable: toNations(
      COUNTRY_ORDER.filter((id) => playableSet.has(id)),
      presetId
    ),
    economy: toNations(roster.econ, presetId),
    registeredCountryCount: REGISTERED_COUNTRY_COUNT,
  };
}

/** "United States, United Kingdom, Soviet Union, and East Germany" */
export function formatNationList(nations: readonly MarketedNation[], conjunction = "and"): string {
  const names = nations.map((n) => n.name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} ${conjunction} ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, ${conjunction} ${names[names.length - 1]}`;
}

/** "United States, United Kingdom, Soviet Union, or East Germany" */
export function formatNationChoices(nations: readonly MarketedNation[]): string {
  return formatNationList(nations, "or");
}

/** SEO keyword fragment: "US politics, UK politics, Soviet Union politics". */
export function nationKeywords(nations: readonly MarketedNation[]): string[] {
  return nations.map((n) => `${n.name} politics`);
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** Prose copy counts nations in words, not digits. "Four are open to players." */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Sentence-leading form, which is where every `{playableCount}` slot sits. */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Fill the `{playableCount}` slot in authored era prose (`eraThemes`).
 *
 * The count always opens a sentence in that copy, so it is capitalised.
 */
export function resolveEraCopy(text: string, world: MarketedWorld): string {
  return text.replaceAll("{playableCount}", capitalize(countWord(world.playable.length)));
}
