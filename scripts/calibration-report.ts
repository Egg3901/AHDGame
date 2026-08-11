/* Usage: npx tsx scripts/calibration-report.ts [country] [era]
 * Prints current-vs-target, loss, and per-region leans for failing cells. */
import { TARGETS } from "@/lib/seeds/calibration/targets";
import { evaluateCell } from "@/lib/seeds/calibration/evaluate";
import { deriveRegionLeans } from "@/lib/seeds/calibration/deriveRegionLeans";
import type { EraId } from "@/lib/seeds/presetSelector";

const [, , onlyCountry, onlyEra] = process.argv;

for (const [country, eras] of Object.entries(TARGETS)) {
  if (onlyCountry && country !== onlyCountry) continue;
  for (const era of Object.keys(eras ?? {}) as EraId[]) {
    if (onlyEra && era !== onlyEra) continue;
    const r = evaluateCell(country, era)!;
    const flag = r.failures.length ? "FAIL" : "ok";
    console.log(
      `\n=== ${country} ${era} [${flag}] mean ${r.meanDisplay.toFixed(2)} spread ${r.spread.toFixed(2)} loss ${r.loss} ===`
    );
    for (const f of r.failures) console.log(`  - ${f}`);
    if (r.failures.length) {
      const rows = deriveRegionLeans(country, era)
        .slice()
        .sort((a, b) => a.display - b.display);
      console.log(
        "  regions: " + rows.map((x) => `${x.regionId} ${x.display.toFixed(1)}`).join(", ")
      );
    }
  }
}
