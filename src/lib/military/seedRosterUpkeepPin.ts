import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { seedRosterUpkeepFor } from "@/lib/military/seedRosterUpkeep";

/**
 * A world's OWN seed-roster upkeep denominators, captured when it was created.
 *
 * `upkeepPerTurn` divides a country's live roster cost by the cost of the roster it
 * STARTED with, so a nation sitting at its historical starting force pays exactly
 * `SEED_UPKEEP_TARGET_SHARE` of its appropriation. `seedRosterUpkeepFor` derives that
 * denominator by calling `buildCountryRoster` at read time, which its own docstring
 * argues for and which is right in one respect: a checked-in table would go stale the
 * moment an archetype's upkeep or a branch's era gate changed.
 *
 * It breaks in exactly one case, and that case is a deploy: when the SEED TABLE ITSELF
 * changes under a world that has already been seeded. The live roster is a database
 * fact from turn one; the denominator is recomputed from whatever the code says today.
 * Change `ORDERS_OF_BATTLE` and every existing army is silently re-priced with nothing
 * having touched the world.
 *
 * Measured on prod (`1953-default`, turn 672) across the authored orders of battle in
 * #1518: the US denominator moves 4,366 to 25,512, which drops its upkeep burden from
 * 0.50 to 0.09 and hands it a nearly free army, while JP (1,453 to 693) and IE (2,226
 * to 547) move the other way into immediate arrears on rosters their players never
 * chose. Nobody edited the world. The code moved underneath it.
 *
 * The pin makes the denominator what it has always logically been: a property of a
 * WORLD, fixed when that world was seeded, not of the current source file. It is
 * captured at bootstrap, preferred at read time, and falls back to derivation when
 * absent so a world created before this existed keeps working unchanged.
 *
 * ⚠️ IT MUST BE REWRITTEN ON EVERY RESEED. `gameConfig` is manifest category
 * `reference`, so teardown does NOT sweep it: a pin left from the previous world would
 * survive a reset and silently hold the NEW world to the OLD world's denominators,
 * which is a worse version of the bug it exists to fix. `captureSeedRosterUpkeepPin`
 * is therefore called unconditionally by the seeder, not only when the field is missing.
 */
export interface SeedRosterUpkeepPin {
  /** The preset this was captured for. A pin never applies to a different one. */
  preset: string;
  /** countryId to the resolved denominator, including the nearest-preset fallback. */
  byCountry: Record<string, number>;
  capturedAt?: Date;
  /** Free text, for a pin written by a heal rather than by the seeder. */
  note?: string;
}

/**
 * Build the pin for a preset from the CURRENT code.
 *
 * Stores the RESOLVED value, the one `seedRosterUpkeepFor` actually returns, not the
 * raw per-preset table. The difference is not cosmetic: DE, DD, AT and NG seed nothing
 * in 1953 because their armed forces are founded later, and resolve through the
 * nearest-preset search instead. Pinning the raw table would drop all four and hand
 * them a free army, which is the exact bug that search was added to fix.
 */
export function captureSeedRosterUpkeepPin(preset: string): SeedRosterUpkeepPin {
  const byCountry: Record<string, number> = {};
  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    const value = seedRosterUpkeepFor(preset, countryId);
    if (value > 0) byCountry[countryId] = value;
  }
  return { preset, byCountry, capturedAt: new Date() };
}

/**
 * Per-process cache. The pin changes once per world, at seed time, so re-reading it for
 * every country on every turn would be a query per country per turn for a value that
 * does not move. A short TTL rather than forever so a heal that writes it lands without
 * a restart.
 */
const CACHE_TTL_MS = 60_000;
let cache: { at: number; pin: SeedRosterUpkeepPin | null } | null = null;

/** Drop the cache. For tests, and for a caller that has just written a new pin. */
export function clearSeedRosterUpkeepPinCache(): void {
  cache = null;
}

async function loadPin(db: Db): Promise<SeedRosterUpkeepPin | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.pin;
  const doc = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { seedRosterUpkeep: 1 } })
    .catch(() => null);
  const pin = (doc as { seedRosterUpkeep?: SeedRosterUpkeepPin } | null)?.seedRosterUpkeep ?? null;
  cache = { at: now, pin };
  return pin;
}

/** Pure: the pinned value when this pin covers this preset and country, else null. */
export function pinnedUpkeep(
  pin: SeedRosterUpkeepPin | null | undefined,
  preset: string,
  countryId: string
): number | null {
  if (!pin || pin.preset !== preset) return null;
  const value = pin.byCountry?.[countryId];
  // A zero or a malformed entry means "no usable pin", never "this army is free":
  // `upkeepPerTurn` divides by this, and a zero denominator is the free-army bug.
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The denominator to charge this country's upkeep against: the world's own pin when it
 * has one, the derived value otherwise.
 *
 * Every caller of `seedRosterUpkeepFor` that touches a LIVE world should use this. The
 * bare derived function remains correct for seeding, calibration and tests, which ask
 * what the current code produces rather than what this world started with.
 */
export async function resolveSeedRosterUpkeep(
  db: Db,
  preset: string,
  countryId: string
): Promise<number> {
  const pin = await loadPin(db);
  return pinnedUpkeep(pin, preset, countryId) ?? seedRosterUpkeepFor(preset, countryId);
}
