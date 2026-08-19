/**
 * SP2 political-metrics dynamics turn phase (dynamics spec §3): enacted laws
 * define per-metric equilibrium targets; every region's politicalMetrics
 * values drift toward them each turn. Writes REGIONAL values only — the
 * national display remains the SP1 read-time population-weighted aggregate.
 *
 * Trend history (§5): every HISTORY_CADENCE_TURNS, the national aggregate is
 * appended to politicalMetricsHistory (capped at HISTORY_MAX_ENTRIES).
 */

import type { AnyBulkWriteOperation, Db } from "mongodb";
import type {
  PoliticalMetricsDoc,
  PoliticalMetricsHistoryDoc,
} from "@/lib/db/types/politicalMetrics";
import type { State } from "@/lib/db/types/state";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import { aggregateNationalPoliticalMetrics } from "@/lib/politicalMetrics/aggregate";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import {
  composeTarget,
  driftStep,
  lawTargets,
  REGIONAL_SUPPLEMENT_FACTOR,
} from "@/lib/politicalLegislation/dynamics";
import { getEnactedLevels } from "@/lib/politicalLegislation/enactedLevels";
import { getPoliticalCabinetContribution } from "@/lib/db/collections/politicalCabinetContribution";
import {
  addContributions,
  foldCabinetResidualsBySource,
  seedBySourceFromLegacy,
  sumCabinetResiduals,
  type CabinetResidualsBySource,
} from "@/lib/politicalMetrics/cabinetResidual";
import { macroResidualFor } from "@/lib/politicalLegislation/macroResidual";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { GameState } from "@/lib/db/types";
import { resolveGameYear } from "@/lib/era/era";
import { spendingProvider } from "@/lib/metricEngine/spendingProvider";
import { governmentApprovalProvider, sectorRevenueTaxProvider } from "@/lib/metricEngine/providers";
import type { SectorRevenueTaxPayload } from "@/lib/metricEngine/registry/economic";
import { getNeutralFederalSalesTaxRate, getNeutralStateSalesTaxRate } from "@/lib/turn/gdpGrowth";
import { legacyPoliticalHalfFromBoard } from "@/lib/politicalLegislation/legacyProjection";
import { politicalNodeTargets } from "@/lib/politicalMetrics/engineNodes";
import { engineTermFor } from "@/lib/politicalMetrics/engineTerm";
import { loadLabourRelationsPoliticalNudgesByCountry } from "@/lib/unions/labourRelationsPoliticalProvider";

export const HISTORY_CADENCE_TURNS = 24;
export const HISTORY_MAX_ENTRIES = 365;

/** Shallow numeric-map equality — whether a cabinetResiduals fold produced a change. */
function sameNums(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/** The same shallow comparison, one level deeper, for the per-source residuals. */
function sameBySource(
  a: Record<string, Record<string, number>>,
  b: Record<string, Record<string, number>>
): boolean {
  const sources = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const source of sources) if (!sameNums(a[source] ?? {}, b[source] ?? {})) return false;
  return true;
}

/**
 * `{ category: { metricId: { value } } }` → `{ "category.metricId": value }`.
 *
 * The engine's node ids ARE legacy dotted paths, so this is the whole adapter
 * between the board's legacy projection and a node's input map. Non-finite
 * entries are dropped rather than passed through: a node reading NaN would
 * produce a NaN target, and every family sharing it would lose its average.
 */
function flattenLegacy(nested: Record<string, unknown> | null): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [category, metrics] of Object.entries(nested ?? {})) {
    for (const [metricId, mv] of Object.entries(
      (metrics ?? {}) as Record<string, { value?: number }>
    )) {
      const v = mv?.value;
      if (typeof v === "number" && Number.isFinite(v)) flat[`${category}.${metricId}`] = v;
    }
  }
  return flat;
}

export async function processPoliticalMetricsDynamics(
  db: Db,
  turnNumber: number
): Promise<{ countriesProcessed: number; regionsDrifted: number }> {
  let countriesProcessed = 0;
  let regionsDrifted = 0;

  // Every country that HAS a board, not just the four with a law catalog.
  // Since the step-6 cutover the non-playables' consumers read the board, so a
  // board nothing ever writes would freeze their approval, corp margins and
  // crisis triggers at their seeded values forever. Their law target composes
  // to zero (empty catalog), the self-heal adopts their seeded values as
  // equilibrium so there is no lurch, and Bridge B's macro term is what moves
  // them until their legislation is ported.
  //
  // Read from the collection rather than a constant: the seeded set is the
  // authority, so adding a country to the board cannot leave it undriven.
  const countryIds = (
    await db.collection<PoliticalMetricsDoc>("politicalMetrics").distinct("countryId")
  ).filter(Boolean);

  // Inputs for the ENGINE TERM — the metric engine's political nodes, which
  // model outcomes causally (spending -> attainment, inequality -> safety) and
  // used to own values in the retired legacy store. They are evaluated HERE
  // rather than in `runMetricEngine` because `stateEffectsPhase` runs that
  // engine in PARALLEL with this phase: anything it persisted would only be
  // readable here a turn late, and every political outcome would lag its cause.
  //
  // These three providers are read by the engine too. The duplicate read is the
  // price of the parallelism above; sharing them would mean serializing the two
  // phases, which costs more than the queries do.
  const [
    spendingRollup,
    approvalByCountry,
    sectorTax,
    eraGameState,
    labourRelationsNudgesByCountry,
  ] = await Promise.all([
    spendingProvider(db),
    governmentApprovalProvider(db),
    sectorRevenueTaxProvider(db),
    db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentYear: 1, currentTurn: 1, startingYear: 1, eraSystemEnabled: 1 } }
      ),
    loadLabourRelationsPoliticalNudgesByCountry(db, turnNumber),
  ]);
  // Era-aware only while the era system is on, matching every other consumer:
  // a metric's realistic span moves with the era, so scoring a 1953 outcome
  // against modern thresholds would read it as bottom-of-scale.
  const eraYear = eraGameState?.eraSystemEnabled
    ? (resolveGameYear(eraGameState) ?? undefined)
    : undefined;

  await Promise.all(
    countryIds.map(async (countryId) => {
      // Countries are independent: each reads and writes only its own docs, so
      // the whole fan-out runs concurrently. The four country-scoped reads are
      // independent of one another too.
      const [docs, nationalLevels, cabinetSnapshot, macroDocs] = await Promise.all([
        db.collection<PoliticalMetricsDoc>("politicalMetrics").find({ countryId }).toArray(),
        getEnactedLevels(db, countryId),
        // Standing cabinet effects (momentum driver channel): the contribution
        // snapshot the ministerial step persisted last turn. National standing
        // effects apply to every region; `regional[id]` is the extra from
        // sited assets (estates, regional orders). Folded into each region
        // doc's decaying `cabinetResiduals` and added on top of the day-one
        // `residuals` in composeTarget. Empty snapshot → residual decays to 0.
        getPoliticalCabinetContribution(db, countryId),
        // Bridge B: the region's macro reality, flattened to "category.metricId".
        // Only the macro-owned categories matter — the political board supplies
        // everything else.
        db.collection<MacroMetricsDoc>("macroMetrics").find({ countryId }).toArray(),
      ]);
      if (docs.length === 0) return;
      countriesProcessed++;

      const national = lawTargets(countryId, nationalLevels);
      const labourRelationsContribution = labourRelationsNudgesByCountry.get(countryId);
      const labourRelationsOf = (id: PoliticalMetricId) =>
        labourRelationsContribution?.get(id) ?? 0;
      // Persisted per region alongside cabinetResiduals so the labour term is
      // inspectable: a strike wave that moves the board leaves a stored number
      // naming the metrics it moved and by how much. The provider owns the
      // decay, so this is a snapshot of the applied offset, not an accumulator.
      const nextLabour: Record<string, number> = {};
      for (const [id, value] of labourRelationsContribution ?? []) nextLabour[id] = value;

      const macroByRegion = new Map<string, Record<string, number>>();
      for (const m of macroDocs) {
        const flat: Record<string, number> = {};
        for (const category of ["economic", "population"] as const) {
          const cat = (m as unknown as Record<string, Record<string, { value?: number }>>)[
            category
          ];
          if (!cat) continue;
          for (const [metricId, mv] of Object.entries(cat)) {
            const v = mv?.value;
            if (typeof v === "number" && Number.isFinite(v)) flat[`${category}.${metricId}`] = v;
          }
        }
        macroByRegion.set(String(m._id), flat);
      }

      // Regional enactments (supplements): one query, grouped per region.
      const catalogLawIds = getCatalog(countryId)
        .filter((law) => law.kind !== "tax")
        .map((law) => law.id);
      const regionalRecords = await db
        .collection<StatePolicy>("statePolicies")
        .find(
          {
            scope: "state",
            stateId: { $in: docs.map((d) => d._id) },
            legislationTypeId: { $in: catalogLawIds },
          },
          { projection: { stateId: 1, legislationTypeId: 1, policyOptionIndex: 1 } }
        )
        .toArray();
      const regionalLevelsByRegion = new Map<string, Map<string, number>>();
      for (const record of regionalRecords) {
        const levels = regionalLevelsByRegion.get(record.stateId) ?? new Map<string, number>();
        levels.set(
          record.legislationTypeId,
          Math.max(0, Math.min(4, record.policyOptionIndex ?? 0))
        );
        regionalLevelsByRegion.set(record.stateId, levels);
      }

      const now = new Date();
      const ops: AnyBulkWriteOperation<PoliticalMetricsDoc>[] = [];
      for (const doc of docs) {
        const regionalLevels = regionalLevelsByRegion.get(doc._id);
        const supplement = regionalLevels
          ? lawTargets(countryId, regionalLevels)
          : (null as Record<PoliticalMetricId, number> | null);

        const nextValues: Record<PoliticalMetricId, number> = { ...doc.values };
        let residuals = doc.residuals;
        let healed = false;
        let changed = false;

        // Accumulate + decay the cabinet contribution into this region's isolated
        // cabinetResiduals (never touches the day-one `residuals`). National
        // standing effects plus this region's sited extras (ticket #1129).
        //
        // Ticket #1129: the cap is applied PER CHANNEL (orders, tier settings,
        // military, estates, energy, infrastructure). Under the old single
        // clamp, 21% of US regional entries sat pinned and a newly built estate
        // aimed at a pinned family contributed exactly zero, which is what two
        // players reported. A channel can still saturate, but it can no longer
        // silence the others.
        const regionId = String(doc._id);
        const contributionBySource: Record<string, Record<string, number>> = {};
        for (const [source, sourceContribution] of Object.entries(cabinetSnapshot.sources)) {
          contributionBySource[source] = addContributions(
            sourceContribution.contribution,
            sourceContribution.regional[regionId] ?? {}
          );
        }
        if (Object.keys(cabinetSnapshot.sources).length === 0) {
          // Pre-#1129 snapshot (the ministerial step has not run since the
          // deploy): treat the whole thing as one channel for this turn. The
          // next ministerial step writes the split.
          const merged = addContributions(
            cabinetSnapshot.contribution,
            cabinetSnapshot.regional[regionId] ?? {}
          );
          if (Object.keys(merged).length > 0) contributionBySource.legacy = merged;
        }
        // Docs written before the split carry only the flat total. Seed the
        // channels from it by this turn's contribution shares rather than
        // migrating: the applied total is unchanged on the first turn, and the
        // 0.9 decay washes the estimate out within a few turns.
        const prevBySource: CabinetResidualsBySource =
          doc.cabinetResidualsBySource ??
          seedBySourceFromLegacy(doc.cabinetResiduals ?? {}, contributionBySource);
        const nextCabinetBySource = foldCabinetResidualsBySource(
          prevBySource,
          contributionBySource
        );
        const nextCabinet = sumCabinetResiduals(nextCabinetBySource) as Record<
          PoliticalMetricId,
          number
        >;
        const cabinetChanged =
          !sameNums(doc.cabinetResiduals ?? {}, nextCabinet) ||
          !sameBySource(doc.cabinetResidualsBySource ?? {}, nextCabinetBySource);
        const cabinetOf = (id: PoliticalMetricId) => nextCabinet[id] ?? 0;
        const labourChanged = !sameNums(doc.labourResiduals ?? {}, nextLabour);

        // The engine term's inputs, in the legacy "category.metricId" shape the
        // nodes were written against: the region's macro doc, plus the board
        // projected back into legacy units. The board is the political half —
        // there is no stored legacy political value to read any more, and that
        // projection is the exact inverse of the derivation, so a node sees the
        // same number a display would.
        const regionMacro = macroByRegion.get(String(doc._id)) ?? {};
        const nodeTargets = politicalNodeTargets({
          countryId,
          stateId: String(doc._id),
          legacy: { ...regionMacro, ...flattenLegacy(legacyPoliticalHalfFromBoard(doc.values)) },
          spending: spendingRollup.perCapitaByRegion.get(String(doc._id)) ?? {},
          providers: {
            sectorRevenueTax: {
              owned: sectorTax.ownedByState.get(String(doc._id)) ?? [],
              unowned: sectorTax.unownedByState.get(String(doc._id)) ?? [],
              federalSalesTax:
                sectorTax.federalSalesTaxByCountry.get(countryId) ??
                getNeutralFederalSalesTaxRate(countryId),
              stateSalesTax:
                sectorTax.stateSalesTaxByState.get(String(doc._id)) ??
                getNeutralStateSalesTaxRate(countryId),
              countryId,
            } satisfies Partial<SectorRevenueTaxPayload> as SectorRevenueTaxPayload,
            // National approval applied to every region, matching the engine.
            governmentApproval: approvalByCountry.get(countryId) ?? 45,
          },
        });

        // §4 lazy self-heal: a doc without residuals adopts its CURRENT values
        // as equilibrium (the reset rule applied late) — no drift that turn.
        if (!residuals) {
          residuals = {} as Record<PoliticalMetricId, number>;
          for (const [metricId, points] of Object.entries(national)) {
            const supplementPoints = supplement?.[metricId as PoliticalMetricId] ?? 0;
            residuals[metricId as PoliticalMetricId] =
              (doc.values[metricId as PoliticalMetricId] ?? 0) -
              (points + REGIONAL_SUPPLEMENT_FACTOR * supplementPoints);
          }
          healed = true;
        } else {
          for (const [metricId, points] of Object.entries(national)) {
            const id = metricId as PoliticalMetricId;
            const value = doc.values[id] ?? 0;
            const structural = residuals[id] ?? value - points;
            // Bridge B: macro reality bends the equilibrium, bounded so the law
            // ladder still dominates. NOT persisted — `residuals` stays structural.
            const lawTarget = composeTarget(points, supplement?.[id] ?? 0, structural);
            const macroTerm = macroResidualFor(id, lawTarget, regionMacro, countryId);
            // The engine term: the same treatment for the CAUSAL half. Bridge B
            // asks "is the economy better or worse than the law book implies";
            // this asks "are the services this government actually funds better
            // or worse than it implies". Both are bounded so the law ladder still
            // sets the equilibrium and reality only bends it, and neither is
            // persisted into `residuals` — that field is the structural gap fixed
            // at reset, and the self-heal recomputes it from the composed law
            // target, so a per-turn term folded in would corrupt every later heal.
            const engineTerm = engineTermFor(id, lawTarget, nodeTargets, countryId, eraYear);
            // The cabinet term is the third bend, and the only one that carries turn
            // to turn: it lives in its own `cabinetResiduals` field, so it is
            // persisted without contaminating the structural `residuals` the
            // self-heal recomputes from. The labour term rides alongside in its
            // own `labourResiduals` field for the same reason: applied here,
            // stored there, so the strike channel can be read back.
            const target = composeTarget(
              points,
              supplement?.[id] ?? 0,
              structural + macroTerm + engineTerm + cabinetOf(id) + labourRelationsOf(id)
            );
            const next = driftStep(value, target);
            if (next !== value) {
              nextValues[id] = next;
              changed = true;
            }
          }
        }

        if (healed || changed || cabinetChanged || labourChanged) {
          ops.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: {
                  values: nextValues,
                  ...(healed && { residuals }),
                  ...(cabinetChanged && {
                    cabinetResiduals: nextCabinet,
                    cabinetResidualsBySource: nextCabinetBySource,
                  }),
                  ...(labourChanged && { labourResiduals: nextLabour }),
                  lastUpdated: now,
                },
              },
            },
          });
          if (changed) regionsDrifted++;
          // Keep post-drift values for the history aggregate below.
          doc.values = nextValues;
        }
      }

      if (ops.length > 0) {
        await db.collection<PoliticalMetricsDoc>("politicalMetrics").bulkWrite(ops);
      }

      // §5 trend history: national aggregate snapshot on cadence.
      if (turnNumber % HISTORY_CADENCE_TURNS === 0) {
        const states = await db
          .collection<State>("states")
          .find({ countryId: countryId as State["countryId"] }, { projection: { population: 1 } })
          .toArray();
        const populationByRegion = new Map(states.map((s) => [s._id, s.population ?? 0]));
        const values = aggregateNationalPoliticalMetrics(docs, populationByRegion);
        await db.collection<PoliticalMetricsHistoryDoc>("politicalMetricsHistory").updateOne(
          { _id: countryId },
          {
            $push: {
              entries: { $each: [{ turn: turnNumber, values }], $slice: -HISTORY_MAX_ENTRIES },
            },
            $set: { updatedAt: new Date() },
          },
          { upsert: true }
        );
      }
    })
  );

  return { countriesProcessed, regionsDrifted };
}
