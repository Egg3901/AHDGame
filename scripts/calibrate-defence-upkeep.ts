/**
 * Prints the measured seeded-roster upkeep behind `seedRosterUpkeepFor`, per preset and
 * country, so the defence-appropriation calibration is reviewable.
 *
 * The figures are DERIVED at runtime from `buildCountryRoster` rather than pasted into a
 * table (see src/lib/military/seedRosterUpkeep.ts for why), so this script reports rather
 * than generates — there is nothing to copy back. Run it after any change to archetype
 * upkeep, branch era gates, MILITARY_COUNTRY_SCALE, or an authored order of battle, and
 * sanity-check that nothing has moved in a way you did not intend.
 *
 * Read-only. Touches no database.
 *
 * Run: npx tsx scripts/calibrate-defence-upkeep.ts
 */
import { seededRosterUpkeepTable } from "@/lib/military/seedRosterUpkeep";
import { SEED_UPKEEP_TARGET_SHARE } from "@/lib/military/appropriation";
import { MILITARY_COUNTRY_SCALE } from "@/lib/constants/military";
import { SEED_PRESET_IDS } from "@/lib/constants/turnTime";
import type { CountryId } from "@/lib/constants/countries";

const table = seededRosterUpkeepTable();

console.log(
  `Seeded roster upkeep (aggregateForce totalUpkeep, force tier "standard").\n` +
    `A country at this figure pays ${(SEED_UPKEEP_TARGET_SHARE * 100).toFixed(0)}% of its ` +
    `defence appropriation in upkeep; anything it adds beyond costs real money.\n`
);

for (const preset of SEED_PRESET_IDS) {
  const rows = Object.entries(table[preset]).sort((a, b) => b[1] - a[1]);
  console.log(`\n=== ${preset} — ${rows.length} countries with a seeded force ===`);
  console.log("country   upkeep     scale   upkeep/scale");
  for (const [countryId, upkeep] of rows) {
    const scale = MILITARY_COUNTRY_SCALE[countryId as CountryId] ?? 1;
    console.log(
      [
        countryId.padEnd(6),
        String(Math.round(upkeep)).padStart(8),
        scale.toFixed(2).padStart(7),
        // Cost scale removed, so this column compares raw force size across countries —
        // a country that looks wrong here is a signal about its order of battle.
        String(Math.round(upkeep / scale)).padStart(13),
      ].join("  ")
    );
  }
}

const everyCountry = new Set(SEED_PRESET_IDS.flatMap((p) => Object.keys(table[p])));
console.log(`\n${everyCountry.size} distinct countries field a seeded force across all presets.`);
