/**
 * Political-legislation v2 seeding (design spec §6/§7): projects the playable
 * countries' typed catalogs into legislationTypes docs, seeds the enacted
 * baseline for the world's YEAR (statePolicies + enactedLaws), and runs one
 * budget sync so day-one budgets reflect the inherited law book.
 *
 * Runs on EVERY preset: law existence and day-one levels resolve by year
 * (catalog.isLawActive / baselineLevelFor), not by the seed preset string.
 * Non-playable countries' old catalogs are untouched; the US/UK/RU/DD old
 * catalogs are excluded in seedLegislationTypes.
 */

import { ObjectId } from "mongodb";
import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { EnactedLaw } from "@/lib/db/types/budget";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import type { LegislationType, StatePolicyRecord } from "@/lib/db/types/legislation";
import {
  getAllNewGenerationLawIds,
  getCatalog,
  getRegionalCatalog,
  baselineLevelFor,
} from "@/lib/politicalLegislation/catalog";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";
import { countryFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import { budgetKeyForLaw } from "@/lib/politicalLegislation/budgetKeys";
import {
  REGIONAL_SUPPLEMENT_FACTOR,
  lawTargets,
} from "@/lib/politicalLegislation/dynamics";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import { LAW_COUNTRY_IDS, type LawCountryId } from "@/lib/politicalLegislation/types";
import { DD_LAND_STATE_IDS } from "@/lib/politicalLegislation/laws/ddLandLaws";
import { refreshNationalBudgetRevenue } from "@/lib/budget/revenue";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { NATIONAL_POLICY_STATE_IDS } from "@/lib/policy/nationalStateId";
import type { CountryId } from "@/lib/constants/countries";

// The gate lives in ONE place (politicalMetrics/pipelinePreset) so the four
// seed call sites cannot drift apart again. Re-exported under the historical
// name so existing importers need no edit.
export { isPoliticalPipelinePreset as isPoliticalLegislationPreset } from "@/lib/politicalMetrics/pipelinePreset";

/**
 * The projected docs seedLegislationTypes upserts. Omitting `year` projects the
 * whole catalog; passing one projects only the laws that exist then, so a world
 * never gets a proposable type for a law outside its era window.
 */
export function getProjectedPoliticalLegislationTypes(year?: number): LegislationType[] {
  return LAW_COUNTRY_IDS.flatMap((countryId) =>
    getCatalog(countryId, year).map(projectLawToLegislationType)
  );
}

/**
 * Deterministic per-law ObjectId so baseline reseeding is idempotent (mirrors
 * the SEED_BILL_ID pattern in budgets.ts). 12-byte hex derived from the law id.
 */
export function baselineEnactedLawId(lawId: string): ObjectId {
  let hash = 0;
  for (let i = 0; i < lawId.length; i++) {
    hash = (hash * 31 + lawId.charCodeAt(i)) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  return new ObjectId(`60b15e11${hex}00000000`.slice(0, 24));
}

const BASELINE_BILL_ID = new ObjectId("60b15e110000000000000001");

/**
 * §7 authored 1953 enacted baseline: one national statePolicies record per
 * program law (explicit policyOptionId "l<level>" — level 0 included so the
 * readback layer sees an explicit repealed state), plus an enactedLaws record
 * for every law above level 0 (costed at national scope through the cost
 * engine). Tax laws seed NEITHER — their state is federalBudget.taxRates,
 * written by the budget seed from SEED_TAX_RATES_1953.
 */
export async function seedPoliticalLegislationBaseline(
  db: Db,
  log: (msg: string) => void,
  year: number
): Promise<void> {
  const now = new Date();
  let policyCount = 0;
  let lawCount = 0;
  const policyOps: AnyBulkWriteOperation<StatePolicyRecord>[] = [];
  const lawOps: AnyBulkWriteOperation<EnactedLaw>[] = [];

  // Purge leftover old-generation national enacted laws for political-legislation
  // countries. Country budget seeders may have already written uk_nhs_funding /
  // us_defense_spending / etc. from generateDefaultEnactedLaws before this runs;
  // leaving them would double-count (or misprice) against the v2 baseline book.
  const oldLawPurge = await db.collection<EnactedLaw>("enactedLaws").deleteMany({
    countryId: { $in: [...LAW_COUNTRY_IDS] },
    scope: "national",
    legislationTypeId: {
      $nin: getAllNewGenerationLawIds(),
    },
  });
  if (oldLawPurge.deletedCount > 0) {
    log(
      `Purged ${oldLawPurge.deletedCount} old-generation national enacted law(s) before political baseline`
    );
  }

  for (const countryId of LAW_COUNTRY_IDS) {
    const base = await countryFiscalBase(db, countryId);
    for (const law of getCatalog(countryId, year)) {
      if (law.kind === "tax") continue;
      // Regional-only sidecars seed per-state below — never as national.
      if (law.allowedScope === "regional") continue;
      const level = baselineLevelFor(law, year);
      const doc = projectLawToLegislationType(law);
      const option = doc.policyOptions![level];

      // Keyed on the canonical national stateId (US "federal", UK
      // "uk_national", RU "su_national") so a later bill enactment's
      // {stateId, legislationTypeId} upsert MATCHES this record instead of
      // inserting a stale-baseline duplicate (audit pass 1 finding).
      const nationalStateId = NATIONAL_POLICY_STATE_IDS[countryId];
      policyOps.push({
        updateOne: {
          filter: { scope: "national", stateId: nationalStateId, legislationTypeId: law.id },
          update: {
            $set: {
              scope: "national",
              stateId: nationalStateId,
              legislationTypeId: law.id,
              economic: option.economic,
              social: option.social,
              policyOptionId: option.id,
              policyOptionIndex: level,
              effectDirection: option.effectDirection,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      });
      policyCount++;

      if (level === 0) continue;
      const fiscal = computeLawCost(law.levels![level], base, countryId as LawCountryId, null);
      const enacted: EnactedLaw = {
        _id: baselineEnactedLawId(law.id),
        billId: BASELINE_BILL_ID,
        legislationTypeId: law.id,
        title: law.title,
        scope: "national",
        countryId,
        budgetCost: 0,
        costModelV2: option.costModelV2,
        ...(fiscal.revenue > 0 && { annualRevenueV2: fiscal.revenue }),
        policyOptionIndex: level,
        budgetCategory: budgetKeyForLaw(law),
        enactedAt: now,
        enactedYear: year,
      };
      lawOps.push({
        replaceOne: { filter: { _id: enacted._id }, replacement: enacted, upsert: true },
      });
      lawCount++;
    }

    // Regional sidecar baselines (DD Land laws today): statePolicies only —
    // no enactedLaws, no budget sync. Live regions intersect the authored
    // Land id list so a drifted world cannot invent phantom Bezirke.
    const regionalLaws = getRegionalCatalog(countryId, year).filter((law) => law.kind !== "tax");
    if (regionalLaws.length > 0) {
      const allowed =
        countryId === "DD" ? new Set<string>(DD_LAND_STATE_IDS) : null;
      const states = await db
        .collection<{ _id: string }>("states")
        .find({ countryId }, { projection: { _id: 1 } })
        .toArray();
      const regionIds = states
        .map((s) => String(s._id))
        .filter((id) => (allowed ? allowed.has(id) : true));
      for (const stateId of regionIds) {
        for (const law of regionalLaws) {
          const level = baselineLevelFor(law, year);
          const doc = projectLawToLegislationType(law);
          const option = doc.policyOptions![level];
          policyOps.push({
            updateOne: {
              filter: { scope: "state", stateId, legislationTypeId: law.id },
              update: {
                $set: {
                  scope: "state",
                  stateId,
                  legislationTypeId: law.id,
                  economic: option.economic,
                  social: option.social,
                  policyOptionId: option.id,
                  policyOptionIndex: level,
                  effectDirection: option.effectDirection,
                  updatedAt: now,
                },
              },
              upsert: true,
            },
          });
          policyCount++;
        }
      }
    }
  }

  // Flushed before the budget sync below, which READS `enactedLaws` — batching
  // must not let that sync run ahead of the law book it is summing.
  if (policyOps.length > 0) {
    await db.collection<StatePolicyRecord>("statePolicies").bulkWrite(policyOps, { ordered: true });
  }
  if (lawOps.length > 0) {
    await db.collection<EnactedLaw>("enactedLaws").bulkWrite(lawOps, { ordered: true });
  }

  // One budget sync so day-one budgets reflect the inherited law book
  // (recomputes revenue.lawRevenue AND spending.byCategory from enacted laws).
  // Map through getNationalBudgetId — US lives at `_id: "federal"`, not "US".
  // Passing country codes made the US sync a silent no-op (defense stayed on
  // the modern underweight ladder; surplus never flipped to Korean War deficit).
  await refreshNationalBudgetRevenue(
    db,
    LAW_COUNTRY_IDS.map((cc) => getNationalBudgetId(cc as CountryId))
  );

  const residualCount = await seedPoliticalMetricsResiduals(db, year);

  log(
    `Seeded political-legislation ${year} baseline: ${policyCount} policy records, ` +
      `${lawCount} enacted laws, ${residualCount} metric residual sets, budgets synced`
  );
}

/**
 * SP2 residual initialization (dynamics spec §4): residual = seed − dayOneTarget
 * per region per metric, so every region starts EXACTLY at equilibrium — the
 * §5b seed-vs-law gaps ARE the residuals, and day one drifts nothing.
 *
 * Day-one target = national law book + REGIONAL_SUPPLEMENT_FACTOR × regional
 * sidecar baselines (DD Land laws). Idempotent.
 */
export async function seedPoliticalMetricsResiduals(db: Db, year: number): Promise<number> {
  const now = new Date();
  let count = 0;
  const residualOps: AnyBulkWriteOperation<PoliticalMetricsDoc>[] = [];
  for (const countryId of LAW_COUNTRY_IDS) {
    const levels = new Map(
      getCatalog(countryId, year)
        .filter((law) => law.kind !== "tax" && law.allowedScope !== "regional")
        .map((law) => [law.id, baselineLevelFor(law, year)])
    );
    const national = lawTargets(countryId, levels);

    const regionalLaws = getRegionalCatalog(countryId, year).filter((law) => law.kind !== "tax");
    const regionalBaseline = new Map(
      regionalLaws.map((law) => [law.id, baselineLevelFor(law, year)])
    );
    const regionalSupplement =
      regionalBaseline.size > 0 ? lawTargets(countryId, regionalBaseline) : null;

    const docs = await db
      .collection<PoliticalMetricsDoc>("politicalMetrics")
      .find({ countryId })
      .toArray();
    for (const doc of docs) {
      const residuals = {} as Record<PoliticalMetricId, number>;
      for (const [metricId, points] of Object.entries(national)) {
        const id = metricId as PoliticalMetricId;
        const supplementPoints = regionalSupplement?.[id] ?? 0;
        residuals[id] =
          (doc.values[id] ?? 0) - (points + REGIONAL_SUPPLEMENT_FACTOR * supplementPoints);
      }
      residualOps.push({
        updateOne: { filter: { _id: doc._id }, update: { $set: { residuals, lastUpdated: now } } },
      });
      count++;
    }
  }
  if (residualOps.length > 0) {
    await db
      .collection<PoliticalMetricsDoc>("politicalMetrics")
      .bulkWrite(residualOps, { ordered: true });
  }
  return count;
}

export { getAllNewGenerationLawIds };
