/** Compare the old collapsed seed with corrected background estimates using the real macro kernel. */
import assert from "node:assert/strict";
import { getWorldEntityPresetManifest } from "../../src/lib/world/worldEntityManifest";
import { getStartingYearForPreset } from "../../src/lib/constants/turnTime";
import { COMMODITY_TYPES } from "../../src/lib/constants/commodities";
import { buildBackgroundMacroCountry } from "../../src/lib/world/macro/backgroundSeed";
import { buildBackgroundMacroSpec } from "../../src/lib/world/macro/rules/backgroundProfile";
import { buildMacroCountryFromSpec } from "../../src/lib/world/macro/seedBuilder";
import { computeMacroContribution } from "../../src/lib/world/macro/kernel";
import { isMacroTickTurn } from "../../src/lib/world/macro/schedule";
import type { MacroCountryState } from "../../src/lib/world/macro/types";

function legacyUnit(id: string, salt: number): number {
  let hash = salt >>> 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash / 0xffffffff;
}

function summarize(countries: MacroCountryState[]) {
  const populations = countries.map((country) => country.population).sort((a, b) => a - b);
  return {
    count: countries.length,
    population: populations.reduce((a, b) => a + b, 0),
    minimum: populations[0],
    median: populations[Math.floor(populations.length / 2)],
    maximum: populations.at(-1),
    distinct: new Set(populations).size,
    nearFloor: populations.filter((population) => population < 400_000).length,
    annualGdpGameUnits: Math.round(
      countries.reduce(
        (sum, country) =>
          sum +
          Object.values(country.sectors).reduce(
            (total, sector) => total + (sector?.capacity ?? 0),
            0
          ) *
            48,
        0
      )
    ),
    commodities: Object.fromEntries(
      COMMODITY_TYPES.map((commodity) => [
        commodity,
        {
          supply:
            Math.round(
              countries.reduce(
                (sum, country) => sum + (country.contribution.byCommodity[commodity]?.supply ?? 0),
                0
              ) * 100
            ) / 100,
          demand:
            Math.round(
              countries.reduce(
                (sum, country) => sum + (country.contribution.byCommodity[commodity]?.demand ?? 0),
                0
              ) * 100
            ) / 100,
        },
      ])
    ),
  };
}

const now = new Date("1991-01-20T00:00:00Z");
const results = [];
for (const preset of [
  "1979-default",
  "1991-default",
  "1999-default",
  "2019-default",
  "2027-default",
]) {
  const year = getStartingYearForPreset(preset);
  const entries = getWorldEntityPresetManifest(preset).entries.filter(
    (entry) => entry.simulationTier === "background-macro" && entry.status === "sovereign"
  );
  const corrected = entries.map((entry) => buildBackgroundMacroCountry(entry, preset, now));
  const legacy = entries.map((entry) => {
    const spec = buildBackgroundMacroSpec(
      entry.entityId,
      entry.displayName,
      entry.economicArchetype,
      year
    );
    const unit = (salt: number) => legacyUnit(entry.entityId, salt);
    spec.population = Math.round(350_000 + unit(17) ** 2 * 95_000_000);
    spec.annualGdpGameUnits = Math.max(
      100,
      Math.round(
        (spec.population * (900 + Math.max(0, year - 1950) * 115) * (0.55 + unit(41) * 1.9)) /
          1_000_000
      )
    );
    spec.fiscalCapacity = 0.2 + unit(73) * 0.45;
    spec.stability = 0.4 + unit(97) * 0.45;
    spec.tradeExposure = 0.18 + unit(131) * 0.62;
    spec.resources = { timber: 0.2 + unit(181) * 0.8 };
    return buildMacroCountryFromSpec(spec, now, {
      presetId: preset,
      simulationTier: "background-macro",
      provenance: "estimated-background",
    });
  });
  const before = summarize(legacy);
  const after = summarize(corrected);
  assert(after.distinct > after.count * 0.9);
  assert(after.nearFloor < after.count * 0.1);
  const scenarios = [];
  for (const [name, shockModifier] of [
    ["baseline", 1],
    ["output-shock", 0.5],
    ["output-recovery", 1.25],
  ] as const) {
    const countries = corrected.map((country) => ({ ...country, shockModifier }));
    const held = countries.map((country) => ({
      ...country,
      contribution: computeMacroContribution(country, 1),
    }));
    let refreshes = 0;
    for (let turn = 2; turn <= 48; turn++) {
      for (const country of held) {
        if (isMacroTickTurn(turn, country.entityId)) {
          country.contribution = computeMacroContribution(country, turn);
          refreshes++;
        }
        const expected = computeMacroContribution(country, country.contribution.computedOnTurn);
        assert.deepEqual(country.contribution, expected);
        for (const balance of Object.values(country.contribution.byCommodity)) {
          assert(Number.isFinite(balance.supply) && balance.supply >= 0);
          assert(Number.isFinite(balance.demand) && balance.demand >= 0);
        }
      }
    }
    assert(refreshes > 0);
    scenarios.push({ name, shockModifier, refreshes, after48Turns: summarize(held) });
  }
  for (const commodity of COMMODITY_TYPES) {
    const baseline = scenarios[0].after48Turns.commodities[commodity];
    const shock = scenarios[1].after48Turns.commodities[commodity];
    const recovery = scenarios[2].after48Turns.commodities[commodity];
    assert(shock.supply <= baseline.supply);
    assert(recovery.supply >= baseline.supply);
    assert.equal(shock.demand, baseline.demand);
    assert.equal(recovery.demand, baseline.demand);
  }
  results.push({
    preset,
    before,
    after,
    populationRatio: after.population / before.population,
    gdpRatio: after.annualGdpGameUnits / before.annualGdpGameUnits,
    scenarios,
  });
}
console.log(
  JSON.stringify(
    {
      scope:
        "Real background builder, sector builder and macro kernel; fixed inputs and six-turn scheduling, without database or world price clearing.",
      results,
    },
    null,
    2
  )
);
