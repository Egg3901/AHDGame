/**
 * Deterministic 1991 approval qualification using authored seed state only.
 * Run: npx tsx scripts/sim/approvalModifiersV2.ts <absolute-report-path.json>
 * No database connection, production data, writes or turn advancement.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { BSON } from "mongodb";
const { calculateObjectSize } = BSON;

import type { PoliticalMetricId, PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";
import type { StateMetrics } from "@/lib/db/types";

async function main() {
  // Legacy US seed modules consume ambient randomness while loading. Pin it
  // before importing any game modules so both arms use reproducible authored seeds.
  const originalRandom = Math.random;
  let seed = 3772;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  try {
    const { buildOpeningMetricSnapshots1991 } = await import("@/lib/resetMetrics/seedOpening1991");
    const { evaluateResetApprovalModifiers, resetApprovalBaseMetrics, resetApprovalDirections } =
      await import("@/lib/resetMetrics/rules/approval");
    const {
      computeNationalAveragesFromMetrics,
      computeStateApprovalBase,
      buildFlatMetrics,
      dampApprovalStep,
      BASE_APPROVAL,
      PUBLIC_EXPECTATIONS_MODIFIER,
    } = await import("@/lib/utils/governmentApproval");
    const { applyModifiers } = await import("@/lib/utils/approvalModifiers");
    const { nationalApprovalFromRegions } = await import("@/lib/country/rules/nationalApproval");
    const { loadSeededStateMetrics } = await import("@/lib/states/conditions/seedMetricsLoader");
    const { mergeRegionMetrics } = await import("@/lib/macroMetrics/merge");
    const { splitMetricsDoc } = await import("@/lib/macroMetrics/split");
    const { approvalComponent } = await import("@/lib/politicalLegislation/politicalApproval");
    const { POLITICAL_BASELINE_ANCHORS, baselineFor } =
      await import("@/lib/politicalMetrics/seeds/baselineAnchors");
    const { REGIONAL_TEXTURE_1991 } =
      await import("@/lib/politicalMetrics/seeds/regionalTexture1991");
    const { NON_PLAYABLE_BOARDS } = await import("@/lib/politicalMetrics/seeds/nonPlayableBoards");
    const { US_CONFIG } = await import("@/lib/countries/us/institutionsFacts");
    const { UK_CONFIG } = await import("@/lib/countries/uk/institutionsFacts");
    const { states1991 } = await import("@/lib/countries/us/data/usStates1991");
    const { ukRegions1991 } = await import("@/lib/countries/uk/data/ukRegions1991");
    const { jpRegions1991 } = await import("@/lib/countries/jp/data/jpRegions1991");
    const { ieRegions1991 } = await import("@/lib/countries/ie/data/ieRegions1991");
    const output = process.argv[2];
    assert(output && isAbsolute(output), "Supply an absolute report path outside the source tree");
    const populations = { US: states1991, UK: ukRegions1991, JP: jpRegions1991, IE: ieRegions1991 };
    const boards = buildOpeningMetricSnapshots1991("qualification", 1);
    const round = (value: number) => Math.round(value * 10) / 10;
    const countries = (["US", "UK", "JP", "IE"] as const).map((countryId) => {
      const rows = boards.filter((board) => board.countryId === countryId && board.regionId);
      const national = boards.find((board) => board._id === `${countryId}:national`)!;
      const source = rows.map((board) => ({ ...board.observations, ...national.observations }));
      const metrics = source.map(
        (observations, i) =>
          ({
            ...resetApprovalBaseMetrics(observations),
            _id: rows[i].regionId!,
            countryId,
          }) as unknown as StateMetrics
      );
      const averages = computeNationalAveragesFromMetrics(metrics);
      const context = { countryId, preset: "1991-default", year: 1991 };
      const regionPopulation = new Map(
        populations[countryId].map((region) => [String(region._id), region.population])
      );
      const candidate = metrics.map((metric, i) => {
        const base = computeStateApprovalBase(
          metric,
          averages,
          undefined,
          context.preset,
          context.year,
          resetApprovalDirections
        );
        const modifiers = evaluateResetApprovalModifiers(source[i], context);
        return {
          base,
          approval: applyModifiers(base, modifiers),
          modifiers,
          metrics: buildFlatMetrics(metric),
          population: regionPopulation.get(String(metric._id))!,
        };
      });
      const legacyMetrics = loadSeededStateMetrics(countryId, "1991-default").map((metric) =>
        mergeRegionMetrics(splitMetricsDoc(metric).macro)!
      );
      let politicalBytes = 0;
      const legacy = rows.map((row) => {
        let values: Record<PoliticalMetricId, number>;
        if (countryId === US_CONFIG.id || countryId === UK_CONFIG.id) {
          const cc = countryId as PoliticalMetricsCountryId;
          values = Object.fromEntries(
            Object.keys(POLITICAL_BASELINE_ANCHORS[cc]).map((id) => [
              id,
              Math.max(
                0,
                Math.min(
                  100,
                  baselineFor(cc, id as PoliticalMetricId, 1991) +
                    (REGIONAL_TEXTURE_1991[cc]?.[row.regionId!]?.[id as PoliticalMetricId] ?? 0)
                )
              ),
            ])
          ) as Record<PoliticalMetricId, number>;
        } else values = NON_PLAYABLE_BOARDS["1991-default"][countryId][row.regionId!];
        assert(values, `Missing authored v1 board for ${row._id}`);
        politicalBytes += calculateObjectSize({
          _id: row.regionId,
          countryId,
          values,
          lastUpdated: new Date(0),
        });
        const metric = legacyMetrics.find((metric) => metric._id === row.regionId)!;
        assert(metric, `Missing macro seed ${row._id}`);
        const base = round(
          Math.max(
            0,
            Math.min(100, BASE_APPROVAL + approvalComponent(values, 0, countryId, "1991-default"))
          )
        );
        return {
          base,
          population: regionPopulation.get(row.regionId!)!,
          metrics: buildFlatMetrics(metric),
        };
      });
      const old = nationalApprovalFromRegions(legacy, context, [PUBLIC_EXPECTATIONS_MODIFIER]);
      const fresh = nationalApprovalFromRegions(candidate, context, [PUBLIC_EXPECTATIONS_MODIFIER]);
      const targetId = countryId === UK_CONFIG.id ? "SCO" : rows[0].regionId!;
      const target = rows.findIndex((row) => row.regionId === targetId);
      const damaged = { ...source[target] };
      for (const [id, value] of Object.entries({
        "16": 50,
        "17": 30,
        "19": 500,
        "20": 60,
        "31": 1000,
      }))
        damaged[id] = { ...damaged[id], value };
      const damagedApproval = applyModifiers(
        candidate[target].base,
        evaluateResetApprovalModifiers(damaged, context)
      );
      assert(
        damagedApproval < candidate[target].approval,
        `${countryId} must respond to worsening owners`
      );
      let approval = candidate[target].approval;
      const trajectory = Array.from({ length: 24 }, (_, i) => {
        const previous = approval;
        approval = dampApprovalStep(
          previous,
          i < 12 ? damagedApproval : candidate[target].approval
        );
        assert(Math.abs(approval - previous) <= 2);
        return approval;
      });
      assert.equal(trajectory.at(-1), candidate[target].approval);
      assert(
        candidate.every(
          (row) => Number.isFinite(row.approval) && row.approval >= 0 && row.approval <= 100
        )
      );
      const projectedBoards = [...rows, national].map(
        ({ history: _history, observations, ...board }) => ({
          ...board,
          observations: Object.fromEntries(
            Object.entries(observations).map(([id, { note: _note, ...observation }]) => [
              id,
              observation,
            ])
          ),
        })
      );
      return {
        countryId,
        regions: rows.length,
        legacyNational: old.approval,
        v2National: fresh.approval,
        regionalRange: [
          Math.min(...candidate.map((row) => row.approval)),
          Math.max(...candidate.map((row) => row.approval)),
        ],
        activeConditionRange: [
          Math.min(...candidate.map((row) => row.modifiers.length)),
          Math.max(...candidate.map((row) => row.modifiers.length)),
        ],
        nationalBreakdown: fresh.regionalModifiers,
        shock: {
          region: targetId,
          before: candidate[target].approval,
          target: damagedApproval,
          trajectory,
        },
        sourceReadModel: {
          providerCommandsBefore: 3,
          providerCommandsAfter: 3,
          legacyPoliticalBsonBytes: politicalBytes,
          v2ObservationBsonBytes: projectedBoards.reduce(
            (sum, board) => sum + calculateObjectSize(board),
            0
          ),
        },
      };
    });
    const report = {
      verdict: "passed",
      kind: "deterministic seed and owner-shock qualification",
      seed: 3772,
      preset: "1991-default",
      regionCount: countries.reduce((sum, country) => sum + country.regions, 0),
      horizon: 24,
      limitations: [
        "Not an integrated world simulation or live-world replay",
        "Electorate lean fixed at zero for the v1 seed comparison",
        "BSON bytes are serialized projected fixture payloads; command counts describe the provider query plan, not a native Mongo profile",
        "Cabinet, war, addresses and other national providers are covered by regression tests rather than this rules replay",
      ],
      countries,
    };
    writeFileSync(resolve(output), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          verdict: report.verdict,
          regions: report.regionCount,
          countries: countries.map(
            ({
              countryId,
              legacyNational,
              v2National,
              regionalRange,
              activeConditionRange,
              sourceReadModel,
            }) => ({
              countryId,
              legacyNational,
              v2National,
              regionalRange,
              activeConditionRange,
              sourceReadModel,
            })
          ),
        },
        null,
        2
      )
    );
  } finally {
    Math.random = originalRandom;
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
