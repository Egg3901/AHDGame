/**
 * Deterministic UK 1991 demographic sensitivity fixture (#3270).
 * Runs seed derivation and the game's actual appeal/unit rules without a DB.
 * Campaign comparisons hold funding, recognition, org and favorability equal.
 */
import assert from "node:assert/strict";
import { getUkModel } from "@/lib/countries/uk/layer1Model";
import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import { ukDemographicCategories } from "@/lib/seeds/uk/ukDemographicCategories";
import { buildModelRegionDemographics } from "@/lib/seeds/international/derive";
import { applyEra1991DemographicAdjustments } from "@/lib/seeds/reference/stateDemographics1991";
import { calculateStateLean } from "@/lib/utils/demographics";
import { getSocialPositionName } from "@/lib/utils/politics";
import { calcAppeal } from "@/lib/utils/demographicAppeal";
import { deriveGranularElectorateUnits } from "@/lib/demographics/granularElectorate";
import type { Layer1PositionOverlay, StateDemographics } from "@/lib/db/types";

// Frozen pre-fix social inputs. Economic/census/composition/turnout inputs are
// unchanged by this PR and remain read from the model, never reimplemented.
const LEGACY_SOCIAL = {
  age: { young: -0.4, mid: 3.1, mature: 1.5, senior: 3.2 },
  education: {
    no_qualifications: 1.2,
    gcse_equivalent: -0.4,
    a_level_equivalent: 2.3,
    degree_plus: 0.5,
  },
  income: { low: 0.1, middle: -3.1, high: 2.8 },
};

const treatment = getUkModel("1991");
const baseline = structuredClone(treatment);
const oldSocialOverlay: Layer1PositionOverlay = {};
for (const [dim, entries] of Object.entries(LEGACY_SOCIAL)) {
  oldSocialOverlay[dim] = {};
  for (const [key, socialLean] of Object.entries(entries)) {
    oldSocialOverlay[dim][key] = {
      economicLean: 0,
      socialLean: socialLean - treatment.positions[dim][key].socialLean,
    };
    baseline.positions[dim][key].socialLean = socialLean;
  }
}

const cleanBefore = buildModelRegionDemographics(baseline);
const releaseBefore = cleanBefore.map((doc) => applyEra1991DemographicAdjustments(doc, "UK"));
const liveBefore = buildModelRegionDemographics({ ...baseline, regionalContext: undefined }).map(
  (doc) => applyEra1991DemographicAdjustments(doc, "UK")
);
const after = buildModelRegionDemographics(treatment);
const population = Object.fromEntries(
  ukRegions1991.map((region) => [region._id, region.population])
);
const lean = (doc: StateDemographics) => calculateStateLean(doc, ukDemographicCategories);
const round = (value: number) => Math.round(value * 100) / 100;
const fmt = (value: number) => value.toFixed(2);
const means = (docs: StateDemographics[], gbOnly = false) => {
  const rows = docs.filter((doc) => !gbOnly || doc._id !== "NIR");
  const total = rows.reduce((sum, doc) => sum + population[String(doc._id)], 0);
  const economic =
    rows.reduce((sum, doc) => sum + lean(doc).economicLean * population[String(doc._id)], 0) /
    total;
  const social =
    rows.reduce((sum, doc) => sum + lean(doc).socialLean * population[String(doc._id)], 0) / total;
  const e = rows.map((doc) => lean(doc).economicLean);
  const s = rows.map((doc) => lean(doc).socialLean);
  return {
    economic: round(economic),
    social: round(social),
    economicSpread: round(Math.max(...e) - Math.min(...e)),
    socialSpread: round(Math.max(...s) - Math.min(...s)),
  };
};

interface Voter {
  weight: number;
  economicLean: number;
  socialLean: number;
}
const groups = (doc: StateDemographics): Voter[] =>
  Object.values(doc.groups).map((group) => ({
    weight: group.population * (group.turnout ?? 55),
    economicLean: group.economicLean,
    socialLean: group.socialLean,
  }));

function compare(voters: Voter[]) {
  const total = voters.reduce((sum, voter) => sum + voter.weight, 0);
  assert(total > 0);
  // Identical economic position/influence, opposite social positions. Use
  // actual calcAppeal, then normalize the two weights with all other factors
  // held equal. This is a sensitivity measure, not a predicted election result.
  const candidate = (social: number) => {
    let appeal = 0;
    let distance = 0;
    for (const voter of voters) {
      const weight = voter.weight / total;
      appeal += weight * calcAppeal(voter.economicLean, voter.socialLean, -1.5, social, 0, false);
      distance +=
        weight * (Math.abs(voter.economicLean + 1.5) + Math.abs(voter.socialLean - social));
    }
    return { appeal, distance };
  };
  const liberal = candidate(-2);
  const traditional = candidate(2);
  assert(Number.isFinite(liberal.appeal + traditional.appeal));
  return {
    traditionalShare: round((100 * traditional.appeal) / (liberal.appeal + traditional.appeal)),
    liberalDistance: round(liberal.distance),
    traditionalDistance: round(traditional.distance),
  };
}

function granular(region: string, before: boolean): Voter[] {
  const derived = deriveGranularElectorateUnits(
    "UK",
    region,
    "1991-default",
    null,
    before ? oldSocialOverlay : undefined,
    undefined,
    { year: 1991, startingYear: 1991 },
    false,
    "bypass"
  );
  assert(derived && derived.units.length > 0, `No granular electorate for ${region}`);
  return derived.units.map((unit) => ({
    weight: unit.share * unit.turnout,
    economicLean: unit.economicLean,
    socialLean: unit.socialLean,
  }));
}

console.log("# UK 1991 demographic political sensitivity");
console.log("\nIssue #3270. Reproduce: `npx tsx scripts/sim/ukDemographicPolitics1991.ts`.");
console.log(
  "\nFour stages isolate the changes: opening/live baseline (old social inputs, no release economic context, second era transform); release baseline (existing economic context plus second era transform); clean baseline (same old social inputs without that transform); treatment (corrected social inputs and unchanged 1991 shares)."
);
console.log(
  "\n| Region | Live econ/social | Release econ/social | Clean econ/social | Treatment econ/social | Old/retained total | Social label |"
);
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (let i = 0; i < after.length; i++) {
  const vectors = [liveBefore[i], releaseBefore[i], cleanBefore[i], after[i]].map(lean);
  const total = (doc: StateDemographics) =>
    Object.values(doc.groups).reduce((sum, group) => sum + group.population, 0);
  assert(Math.abs(total(after[i]) - 100) < 0.05);
  assert.equal(vectors[2].economicLean, vectors[3].economicLean);
  console.log(
    `| ${after[i]._id} | ${vectors.map((v) => `${fmt(v.economicLean)}/${fmt(v.socialLean)}`).join(" | ")} | ${fmt(total(releaseBefore[i]))}/${fmt(total(after[i]))}% | ${getSocialPositionName(vectors[3].socialLean)} |`
  );
}
console.log(
  "\n| Stage | Population-weighted econ | Population-weighted social | Econ spread | Social spread |"
);
console.log("| --- | --- | --- | --- | --- |");
for (const [name, docs] of [
  ["Live baseline", liveBefore],
  ["Release baseline", releaseBefore],
  ["Clean baseline", cleanBefore],
  ["Treatment", after],
] as const) {
  const summary = means(docs);
  console.log(`| ${name} | ${Object.values(summary).map(fmt).join(" | ")} |`);
}
console.log(`\nGB-only treatment means (excluding NIR): ${JSON.stringify(means(after, true))}.`);
console.log("\n## Actual campaign appeal and policy-distance sensitivity");
console.log(
  "\nCandidates both use economic -1.5 and influence 0, with social -2 versus +2. All other vote multipliers are equal. Shares normalize actual game appeal weights; distances are turnout-weighted Manhattan distances to the demographic positions. Granular columns use the actual pruned/coalesced vote substrate, including year resolution, rather than treating a cached regional average as every voter's position."
);
console.log(
  "\n| Region | Group traditional share before/after | Granular traditional share before/after | Group liberal distance before/after | Group traditional distance before/after |"
);
console.log("| --- | --- | --- | --- | --- |");
for (let i = 0; i < after.length; i++) {
  const oldGroups = compare(groups(releaseBefore[i]));
  const newGroups = compare(groups(after[i]));
  const oldUnits = compare(granular(String(after[i]._id), true));
  const newUnits = compare(granular(String(after[i]._id), false));
  const pair = (a: number, b: number) => `${fmt(a)}/${fmt(b)}`;
  console.log(
    `| ${after[i]._id} | ${pair(oldGroups.traditionalShare, newGroups.traditionalShare)}% | ${pair(oldUnits.traditionalShare, newUnits.traditionalShare)}% | ${pair(oldGroups.liberalDistance, newGroups.liberalDistance)} | ${pair(oldGroups.traditionalDistance, newGroups.traditionalDistance)} |`
  );
}
console.log("\n## Source and limits");
console.log(
  "\n[Published 1991 BSA demographic attitudes](https://natcen.ac.uk/sites/default/files/2023-08/bsa35_full-report.pdf), Gender Table 1, printed p63, provide the age/education/income ordering. The code documents the game's proxy mapping and band approximations in `ukSocialAttitudes1991.ts`. One gender-role item is not a comprehensive social index, and non-disagreement includes neutral/unknown answers. Income tiers approximate the source groups; nominal modern pound thresholds are excluded. Other social input dimensions retain the existing values. No respondent records, fitted regional offsets or party vote labels are used to manufacture social variation."
);
console.log(
  "\nNorthern Ireland retains its separate regional census, receives no economic vote-margin offset, and is not claimed to have been calibrated to GB respondents. [NISA's separate 1991 attitudes](https://www.ark.ac.uk/sol/surveys/gen_social_att/nisa/1991/website/Political_Attitudes/) are a distinct source; this fixture does not infer religion or unionism from ethnicity."
);
console.log(
  "\nIdentical coarse labels can remain valid: the output preserves exact regional means and does not force label diversity. Composition shifts toward older voters or away from graduates now move social lean in the published direction. This bounded fixture establishes derivation and appeal sensitivity, not historical election prediction, multivariate causal estimates, whole-world turnover or long-run balance. The existing economic-context cache/granular distinction predates this change and is not retuned here. Existing worlds are not rewritten by changing seeds."
);
