/**
 * Mechanical transfer of design-only level vectors for the balance workbench.
 * This never marks an option as reviewed or makes it selectable in game.
 * Usage: node scripts/reset/importProvisionalBalanceProfiles.mjs <policy-levels.js> <prototypes.js>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = process.argv[2];
const previewPath = process.argv[3];
if (!sourcePath || !previewPath)
  throw new Error("Pass the authored policy-levels.js and prototypes.js paths");
const text = readFileSync(resolve(sourcePath), "utf8");
const preview = readFileSync(resolve(previewPath), "utf8");
const start = text.indexOf("window.AHD_POLICY_LEVELS = {");
const end = text.indexOf("\n};", start);
if (start < 0 || end < 0) throw new Error("Policy level vectors not found");
const families = JSON.parse(
  readFileSync(resolve("src/lib/resetLegislation/familyCatalog.json"), "utf8")
);
const rows = new Map();
for (const match of text.slice(start, end).matchAll(/^\s*(L\d{2}):\s*(\[\[[^\n]+\]\]),?\s*$/gm)) {
  rows.set(match[1], JSON.parse(match[2]));
}
if (rows.size !== families.length)
  throw new Error(`Expected ${families.length} profile rows; found ${rows.size}`);
const costStart = preview.indexOf("const baseCostFractions = {");
const costEnd = preview.indexOf("\n  };", costStart);
if (costStart < 0 || costEnd < 0) throw new Error("Design base-cost fractions not found");
const costFractions = new Map();
for (const match of preview.slice(costStart, costEnd).matchAll(/\b(L\d{2}):\s*([0-9.]+)/g)) {
  if (costFractions.has(match[1])) throw new Error(`Duplicate base cost for ${match[1]}`);
  costFractions.set(match[1], Number(match[2]));
}
if (costFractions.size !== families.length)
  throw new Error(`Expected ${families.length} base-cost fractions; found ${costFractions.size}`);
const profiles = families.map((family) => {
  const vectors = rows.get(family.id);
  if (!vectors || vectors.length !== 4 || vectors.some((vector) => vector.length !== 5)) {
    throw new Error(`Missing five four-vector design profile for ${family.id}`);
  }
  if (vectors[0].some((title, index) => title !== family.levels[index].title)) {
    throw new Error(`Titles drifted between design profile and catalog for ${family.id}`);
  }
  if (
    vectors
      .slice(1)
      .flat()
      .some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error(`Non-finite or negative profile number for ${family.id}`);
  }
  const baseCostFractionOfGdp = costFractions.get(family.id);
  if (!Number.isFinite(baseCostFractionOfGdp) || baseCostFractionOfGdp < 0) {
    throw new Error(`Invalid design base cost for ${family.id}`);
  }
  return {
    familyId: family.id,
    status: "provisional-design-only",
    baseCostFractionOfGdp,
    allocationFactors: vectors[1],
    primaryResponse: vectors[2],
    secondaryResponseFactors: vectors[3],
    responseMeaning:
      family.id === "L49"
        ? "country-relative entry access, not migration flow"
        : family.id === "L50" || family.id === "L51"
          ? "legal access only; safety and health outcomes unscored"
          : "illustrative normalized response, not approved game balance",
  };
});
const destination = resolve("src/lib/resetLegislation/provisionalBalanceProfiles.json");
writeFileSync(destination, `${JSON.stringify(profiles, null, 2)}\n`, "utf8");
process.stdout.write(`${destination}: ${profiles.length} design-only profiles\n`);
