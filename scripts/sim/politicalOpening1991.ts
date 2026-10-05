/** Portable qualification of v1 opening and the actual law/macro drift rules. No database. */
import { writeFileSync } from "node:fs";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";

async function main() {
  // Legacy US input generation uses ambient jitter. Pin this isolated process
  // before importing those seeds; runtime seed generation remains unchanged.
  Math.random = () => 0.5;
  const { loadSeededStateMetrics } = await import("@/lib/states/conditions/seedMetricsLoader");
  const { US_GEOGRAPHY } = await import("@/lib/countries/us/geography");
  const { UK_GEOGRAPHY } = await import("@/lib/countries/uk/geography");
  const { JP_GEOGRAPHY } = await import("@/lib/countries/jp/geography");
  const { NATIONAL_BASELINES_1991 } =
    await import("@/lib/politicalMetrics/seeds/nationalBaselines1991");
  const { REGIONAL_TEXTURE_1991 } =
    await import("@/lib/politicalMetrics/seeds/regionalTexture1991");
  const { NON_PLAYABLE_BOARDS } = await import("@/lib/politicalMetrics/seeds/nonPlayableBoards");
  const { approvalComponent } = await import("@/lib/politicalLegislation/politicalApproval");
  const { evaluateModifiers, applyModifiers } = await import("@/lib/utils/approvalModifiers");
  const { getCatalog, baselineLevelFor } = await import("@/lib/politicalLegislation/catalog");
  const { lawTargets, composeTarget, structuralResidual, driftStep } =
    await import("@/lib/politicalLegislation/dynamics");
  const { macroResidualFor } = await import("@/lib/politicalLegislation/macroResidual");
  const { ENGINE_BOUND } = await import("@/lib/politicalMetrics/engineTerm");
  const countries = [];
  for (const cc of ["US", "UK", "JP"] as const) {
    const geography = cc === "US" ? US_GEOGRAPHY : cc === "UK" ? UK_GEOGRAPHY : JP_GEOGRAPHY;
    const regions = geography.regionBundles["1991-default"];
    if (!regions?.length) throw new Error(`Missing ${cc} 1991 regions`);
    const metrics = new Map(
      loadSeededStateMetrics(cc, "1991-default").map((metric) => [String(metric._id), metric])
    );
    const laws = getCatalog(cc, 1991).filter(
      (law) => law.kind !== "tax" && law.allowedScope !== "regional"
    );
    const levels = new Map(laws.map((law) => [law.id, baselineLevelFor(law, 1991)]));
    const targets = lawTargets(cc, levels);
    const outputs = regions.map((region) => {
      const values =
        cc === "JP"
          ? { ...NON_PLAYABLE_BOARDS["1991-default"].JP[region._id] }
          : (Object.fromEntries(
              Object.entries(NATIONAL_BASELINES_1991[cc]).map(([id, value]) => [
                id,
                value + (REGIONAL_TEXTURE_1991[cc][region._id][id as PoliticalMetricId] ?? 0),
              ])
            ) as Record<PoliticalMetricId, number>);
      const legacy = metrics.get(region._id)!;
      const flat: Record<string, Record<string, number>> = {};
      for (const category of ["economic", "population", "governance"] as const) {
        flat[category] = Object.fromEntries(
          Object.entries(legacy[category] ?? {})
            .filter(([, metric]) => typeof (metric as { value?: number }).value === "number")
            .map(([id, metric]) => [id, (metric as { value: number }).value])
        );
      }
      const macro = Object.fromEntries(
        Object.entries(flat).flatMap(([category, entries]) =>
          Object.entries(entries).map(([id, value]) => [`${category}.${id}`, value])
        )
      );
      const approval = (board: Record<PoliticalMetricId, number>) =>
        applyModifiers(
          50 + approvalComponent(board, 0, cc, "1991-default"),
          evaluateModifiers(flat, { countryId: cc, preset: "1991-default", year: 1991 })
        );
      const residuals = Object.fromEntries(
        Object.entries(values).map(([id, value]) => [
          id,
          structuralResidual(value, targets[id as PoliticalMetricId], 0),
        ])
      );
      let equilibriumError = 0;
      for (const [id, value] of Object.entries(values))
        equilibriumError = Math.max(
          equilibriumError,
          Math.abs(value - composeTarget(targets[id as PoliticalMetricId], 0, residuals[id]))
        );
      const path = (engine: number, policy: number) => {
        const current = { ...values };
        let maxStep = 0;
        for (let turn = 0; turn < 48; turn++)
          for (const id of Object.keys(current) as PoliticalMetricId[]) {
            const lawTarget = composeTarget(
              targets[id] + (id === "economy.workerSecurity" ? policy : 0),
              0,
              residuals[id]
            );
            const target = composeTarget(
              targets[id] + (id === "economy.workerSecurity" ? policy : 0),
              0,
              residuals[id] + macroResidualFor(id, lawTarget, macro, cc, 1991) + engine
            );
            const next = driftStep(current[id], target);
            maxStep = Math.max(maxStep, Math.abs(next - current[id]));
            current[id] = next;
          }
        return { approval: approval(current), maxStep };
      };
      const baseline = path(0, 0);
      return {
        id: region._id,
        population: region.population,
        approval: approval(values),
        equilibriumError,
        macro48: baseline,
        engineLow48: path(-ENGINE_BOUND, 0),
        engineHigh48: path(ENGINE_BOUND, 0),
        policy48ApprovalGain: path(0, 12.5).approval - baseline.approval,
      };
    });
    const population = outputs.reduce((sum, region) => sum + region.population, 0);
    const weighted = (value: (region: (typeof outputs)[number]) => number) =>
      outputs.reduce((sum, region) => sum + value(region) * region.population, 0) / population;
    countries.push({
      country: cc,
      regions: outputs.length,
      nationalOpeningApproval: Math.round((weighted((region) => region.approval) - 5) * 10) / 10,
      regionalMin: Math.min(...outputs.map((region) => region.approval)),
      regionalMax: Math.max(...outputs.map((region) => region.approval)),
      equilibriumError: Math.max(...outputs.map((region) => region.equilibriumError)),
      macro48Approval: weighted((region) => region.macro48.approval) - 5,
      engineLow48Approval: weighted((region) => region.engineLow48.approval) - 5,
      engineHigh48Approval: weighted((region) => region.engineHigh48.approval) - 5,
      largestStressStep: Math.max(
        ...outputs.flatMap((region) => [
          region.macro48.maxStep,
          region.engineLow48.maxStep,
          region.engineHigh48.maxStep,
        ])
      ),
      primaryLawOneLevel48Gain: weighted((region) => region.policy48ApprovalGain),
    });
  }
  const report = {
    mode: "portable-v1-opening-law-macro-and-engine-bound-stress",
    year: 1991,
    assumptions:
      "Fixed macro inputs; neutral electorate; no cabinet/labour/conflict events. Engine stress applies each bound uniformly, not an actual funded engine or full-world simulation. JP macro mismatch tracked in issue3262.",
    countries,
    playerRegions: countries.reduce((sum, country) => sum + country.regions, 0),
  };
  if (
    report.playerRegions !== 71 ||
    countries.some((country) => country.equilibriumError > 1e-8 || country.largestStressStep > 0.5)
  )
    throw new Error("Opening qualification failed");
  const output = process.argv.find((value) => value.startsWith("--output="))?.slice(9);
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
