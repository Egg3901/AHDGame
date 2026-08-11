import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { aggregateForce, getBranches } from "@/lib/constants/military";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { SEED_PRESET_IDS, getStartingYearForPreset } from "@/lib/constants/turnTime";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { buildCountryRoster } from "@/lib/admin/seed/seedMilitaryUnits";

/**
 * The force tier rosters are measured at. `standard` is what a freshly seeded world runs
 * (no cabinet setting exists yet), and the tier multiplier cancels in `upkeepPerTurn`'s
 * ratio anyway — measuring at the tier the turn step reads keeps the two honest rather
 * than relying on that cancellation.
 */
const MEASUREMENT_TIER = "standard";

/**
 * `buildCountryRoster` only uses `regionIds` as a non-empty guard — it never reads the ids
 * and no unit field derives from them (seedMilitaryUnits.ts:90 is the sole reference). One
 * placeholder therefore reproduces the real roster exactly, without needing a database.
 */
const ROSTER_REGION_STUB = ["measurement"];

/** preset -> countryId -> measured totalUpkeep. Built once per preset, on first ask. */
const cache = new Map<string, Map<string, number>>();

function measurePreset(preset: string): Map<string, number> {
  const startingYear = getStartingYearForPreset(preset);
  const era = eraForPreset(preset);
  const out = new Map<string, number>();

  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    // Mirrors seedMilitaryUnits' own skip: no branches in this era means no army.
    if (getBranches(countryId, startingYear).length === 0) continue;
    const roster = buildCountryRoster(countryId, ROSTER_REGION_STUB, 1, era, startingYear);
    if (roster.length === 0) continue;
    // buildCountryRoster returns rosters without `_id`; aggregateForce reads none of the
    // identity fields, only the combat/cost ones, all of which are present.
    const { totalUpkeep } = aggregateForce(roster as MilitaryUnit[], countryId, MEASUREMENT_TIER);
    if (totalUpkeep > 0) out.set(countryId, totalUpkeep);
  }
  return out;
}

function forPreset(preset: string): Map<string, number> {
  let measured = cache.get(preset);
  if (!measured) {
    measured = measurePreset(preset);
    cache.set(preset, measured);
  }
  return measured;
}

/**
 * The `aggregateForce().totalUpkeep` of a country's SEEDED order of battle — the
 * denominator `upkeepPerTurn` divides the live roster by, so that a nation sitting at its
 * historical starting force pays exactly `SEED_UPKEEP_TARGET_SHARE` of its appropriation
 * and everything it adds beyond that costs real money.
 *
 * DERIVED from the seeder rather than stored as a generated literal. `buildCountryRoster`
 * is pure and seeded per country, so this reproduces the real roster exactly — and a
 * checked-in table would silently go stale the moment an archetype's upkeep, a branch's
 * era gate, or an authored order of battle changed, shifting every country's upkeep share
 * with nothing to catch it. Deriving it means the numerator and denominator always come
 * from the same source of truth. `scripts/calibrate-defence-upkeep.ts` prints the same
 * numbers for review.
 *
 * Memoised per preset: a world only ever asks about its own, and the computation is pure
 * arithmetic over ~80 countries with no I/O.
 *
 * Falls back to the NEAREST preset in either direction — earlier first, then later — before
 * giving up at 0.
 *
 * Searching later presets matters and is not symmetry for its own sake: a country whose
 * armed forces are established after the world's start year has no seed-era roster at all.
 * DD, DE, AT and NG all seed nothing in 1953 (NVA 1956, Bundeswehr 1955, Bundesheer 1955,
 * Nigerian independence 1960) but seed real rosters from 1979. Those nations can still
 * ACQUIRE units on a 1953 world — by recruiting, or by the clock crossing their branch's
 * establishment year — and an earlier-only search would hand every one of them a permanently
 * free army. The live testing world already had two such DD units.
 *
 * A 0 makes `upkeepPerTurn` charge nothing, which is the safe direction for a per-turn sweep
 * over every country, but it is still a free army — so `seedRosterUpkeep.test.ts` asserts
 * that any country seeding units in ANY preset resolves above zero in EVERY preset.
 */
export function seedRosterUpkeepFor(preset: string, countryId: string): number {
  const direct = forPreset(preset).get(countryId);
  if (direct != null && direct > 0) return direct;

  const idx = SEED_PRESET_IDS.indexOf(preset as (typeof SEED_PRESET_IDS)[number]);
  // An unrecognised preset ("2019-no-parties") scans everything newest-first rather than
  // returning 0, so a variant world still charges upkeep.
  const order =
    idx < 0
      ? [...SEED_PRESET_IDS].reverse()
      : [...SEED_PRESET_IDS.slice(0, idx).reverse(), ...SEED_PRESET_IDS.slice(idx + 1)];

  for (const candidate of order) {
    const found = forPreset(candidate).get(countryId);
    if (found != null && found > 0) return found;
  }
  return 0;
}

/** Every (preset, country) pair with a seeded force. For the calibration report and tests. */
export function seededRosterUpkeepTable(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const preset of SEED_PRESET_IDS) {
    out[preset] = Object.fromEntries(forPreset(preset));
  }
  return out;
}
