import { writeFileSync } from "node:fs";
import { deriveRegionalTexture1991 } from "@/lib/politicalMetrics/derive/opening1991";

const texture = deriveRegionalTexture1991();
if (process.argv.includes("--emit")) {
  writeFileSync(
    "src/lib/politicalMetrics/seeds/regionalTexture1991.ts",
    [
      "/** Generated from committed 1991 regional seeds. National means preserved; bound +/-12. */",
      "/** Regenerate: npx tsx scripts/debug/derive-regional-texture-1991.ts --emit */",
      'import type { PoliticalMetricId } from "../types";',
      "export const REGIONAL_TEXTURE_1991: Record<string, Record<string, Partial<Record<PoliticalMetricId, number>>>> =",
      JSON.stringify(texture, null, 2) + ";",
      "",
    ].join("\n")
  );
}
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(texture).map(([cc, regions]) => [
        cc,
        {
          regions: Object.keys(regions).length,
          texturedCells: Object.values(regions).reduce(
            (sum, values) => sum + Object.keys(values).length,
            0
          ),
        },
      ])
    )
  )
);
