import { getDb } from "@/lib/mongodb";
import type { Db } from "mongodb";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { State } from "@/lib/db/types/state";
import type { FederalBudget, EnactedLaw } from "@/lib/db/types/budget";
import { NATIONAL_SCOPE, NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  DOMINANCE_FLOOR,
  economicModelEra,
  resolveSeedEconomicModel,
  type EconomicModelState,
  type EconomicModelId,
} from "@/lib/constants/economicModels";
import { classify, type ClassifyInput } from "@/lib/economicModels/classify";
import { transition } from "@/lib/economicModels/hysteresis";
import { sectorRevenueTaxProvider } from "@/lib/metricEngine/providers";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";

/** Owned + unowned sector revenue rolled up by CorporationType for one region. */
interface RegionRevenue {
  byType: Record<string, number>;
  total: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Per-category budget shares from a `spending.byCategory` map. */
function spendingShares(byCategory: Record<string, number> | undefined): Record<string, number> {
  if (!byCategory) return {};
  const total = Object.values(byCategory).reduce((s, v) => s + (v || 0), 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [cat, v] of Object.entries(byCategory)) out[cat] = (v || 0) / total;
  return out;
}

/** Classify a region/country and resolve its named model via cold-start or hysteresis. */
function classifyAndTransition(
  prev: EconomicModelState | undefined,
  input: ClassifyInput,
  seedModel: EconomicModelId | undefined,
  now: Date
): EconomicModelState {
  const result = classify(prev?.scores ?? {}, input);

  let current: EconomicModelId;
  let challenger: EconomicModelState["challenger"];
  if (!prev) {
    // Cold start: scores are the computed affinities (no drift lag); the named
    // model is the config seed if present, else the leader (or mixed below floor).
    current = seedModel ?? (result.intensity >= DOMINANCE_FLOOR ? result.leader : "mixed");
  } else {
    const t = transition(
      { current: prev.current, challenger: prev.challenger },
      result.leader,
      result.scores
    );
    current = t.current;
    challenger = t.challenger;
  }

  // Intensity = the DISPLAYED model's own score (equals the leader's in steady
  // state; clearer than the leader's during a contested transition). "mixed" → 0.
  const intensity = clamp(result.scores[current] ?? 0, 0, 100);
  return {
    current,
    intensity,
    scores: result.scores,
    drivers: result.signals[current],
    challenger,
    lastUpdated: now,
  };
}

/**
 * P7 economic-model classification phase. The economic model is NATIONAL ONLY — a
 * country has one model that governs all its regions (regions neither own nor display
 * their own). For each country, rolls up Σ regional sector revenue (by CorporationType),
 * federal spending shares, and active flagship laws, computes the classification (graded
 * sector + spend + law → blended affinity → drifting scores → leader/intensity →
 * hysteresis), and writes the `economicModel` subdoc onto the national-scope `stateMetrics`
 * doc. Effect channels (corp alignment, sector concentration, synergy nudges) all read
 * this national model for every region in the country. Runs after the metric engine +
 * budget + nationalMetrics (all inputs settled, §7).
 */
export async function processEconomicModelTurn(
  _turn: number,
  startingYear?: number
): Promise<{ regionsProcessed: number; countriesProcessed: number }> {
  const db: Db = await getDb();
  // Era-specific seed identities (1991 vs 2019) cold-start a fresh game.
  const era = economicModelEra(startingYear);
  const [
    states,
    allStateMetrics,
    sectorTax,
    enactedLaws,
    federalBudgets,
    corporations,
    corporateSectors,
  ] = await Promise.all([
    db.collection<State>("states").find({}).toArray(),
    // SP5: the model inputs (economic.*) live on macroMetrics now.
    db.collection<StateMetrics>("macroMetrics").find({}).toArray(),
    sectorRevenueTaxProvider(db),
    db
      .collection<EnactedLaw>("enactedLaws")
      .find({ repealedAt: { $exists: false } })
      .project<Pick<EnactedLaw, "legislationTypeId" | "countryId">>({
        legislationTypeId: 1,
        countryId: 1,
      })
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find({})
      .project<Pick<FederalBudget, "_id" | "countryId" | "spending">>({
        countryId: 1,
        spending: 1,
      })
      .toArray(),
    // §State-Capitalist lever: ownership = which corps are National Corporations.
    db
      .collection<Corporation>("corporations")
      .find({})
      .project<Pick<Corporation, "_id" | "countryOwnerId" | "ownershipState">>({
        countryOwnerId: 1,
        ownershipState: 1,
      })
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find({})
      .project<Pick<CorporateSector, "_id" | "corporationId" | "countryId" | "stateId">>({
        corporationId: 1,
        countryId: 1,
        stateId: 1,
      })
      .toArray(),
  ]);

  const metricsById = new Map(allStateMetrics.map((m) => [String(m._id), m]));

  // §State-Capitalist lever: per-region + per-country share of ALL the economy's
  // sectors owned by National Corporations (state ownership). When ≥
  // STATE_CAPITALIST_OWNERSHIP_THRESHOLD it drives the State-Capitalist affinity.
  // The denominator counts EVERY sector — corporate-owned AND unowned — so the
  // share reflects how much of the whole economy the state controls.
  const natCorpIds = new Set<string>();
  for (const c of corporations) if (isStateOwned(c)) natCorpIds.add(String(c._id));
  const ownTotalByCountry = new Map<string, number>();
  const ownSoeByCountry = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
  for (const sec of corporateSectors) {
    const country = String(sec.countryId);
    bump(ownTotalByCountry, country);
    if (natCorpIds.has(String(sec.corporationId))) {
      bump(ownSoeByCountry, country);
    }
  }
  // Unowned sectors are part of the economy NOT nationalized — they count toward the
  // TOTAL (denominator) but never as state-owned.
  const countryByState = new Map(states.map((s) => [String(s._id), String(s.countryId)]));
  for (const [stateId, list] of sectorTax.unownedByState) {
    const country = countryByState.get(String(stateId));
    if (country) bump(ownTotalByCountry, country, list.length);
  }
  const ownershipShare = (soe: number | undefined, total: number | undefined): number =>
    total && total > 0 ? (soe ?? 0) / total : 0;

  // Active flagship-law tags per country (legislationTypeId — best-effort until a
  // law taxonomy lands; intent tags in the registry won't match yet, so the Law
  // signal is largely inert by design, with Sector + Spending carrying the weight).
  const lawTagsByCountry = new Map<string, Set<string>>();
  for (const law of enactedLaws) {
    if (!law.countryId) continue;
    const set = lawTagsByCountry.get(law.countryId) ?? new Set<string>();
    set.add(law.legislationTypeId);
    lawTagsByCountry.set(law.countryId, set);
  }

  const spendByCountry = new Map<string, Record<string, number>>();
  for (const fb of federalBudgets) {
    const countryId = fb.countryId || (String(fb._id) === "federal" ? "US" : String(fb._id));
    spendByCountry.set(countryId, spendingShares(fb.spending?.byCategory));
  }
  const regionRevenue = (stateId: string): RegionRevenue => {
    const byType: Record<string, number> = {};
    let total = 0;
    const owned = sectorTax.ownedByState.get(stateId) ?? [];
    const unowned = sectorTax.unownedByState.get(stateId) ?? [];
    for (const r of owned) {
      if (r.sectorType) byType[r.sectorType] = (byType[r.sectorType] ?? 0) + r.revenue;
      total += r.revenue;
    }
    for (const r of unowned) {
      if (r.sectorType) byType[r.sectorType] = (byType[r.sectorType] ?? 0) + r.revenue;
      total += r.revenue;
    }
    return { byType, total };
  };

  const now = new Date();
  const ops: Array<{
    updateOne: { filter: { _id: string }; update: { $set: { economicModel: EconomicModelState } } };
  }> = [];

  const realStates = states.filter((s) => !NATIONAL_SCOPE_IDS.has(String(s._id)));

  // ── National classification (Σ regional sector revenue — SSOT) ──────────────
  // The model is national only; regions inherit it via the effect channels.
  let countriesProcessed = 0;
  for (const [nationalId, countryId] of Object.entries(NATIONAL_SCOPE) as [string, CountryId][]) {
    const countryStates = realStates.filter((s) => s.countryId === countryId);
    if (countryStates.length === 0) continue;
    const byType: Record<string, number> = {};
    let total = 0;
    for (const st of countryStates) {
      const r = regionRevenue(String(st._id));
      for (const [type, rev] of Object.entries(r.byType)) byType[type] = (byType[type] ?? 0) + rev;
      total += r.total;
    }
    const input: ClassifyInput = {
      revenueByType: byType,
      totalRevenue: total,
      spendingShare: spendByCountry.get(countryId) ?? {},
      activeLawTags: lawTagsByCountry.get(countryId) ?? new Set<string>(),
      stateOwnershipShare: ownershipShare(
        ownSoeByCountry.get(countryId),
        ownTotalByCountry.get(countryId)
      ),
    };
    const seed = resolveSeedEconomicModel(COUNTRY_CONFIGS[countryId]?.seedEconomicModel, era);
    const next = classifyAndTransition(
      metricsById.get(nationalId)?.economicModel,
      input,
      seed,
      now
    );
    ops.push({
      updateOne: { filter: { _id: nationalId }, update: { $set: { economicModel: next } } },
    });
    countriesProcessed += 1;
  }

  if (ops.length > 0) {
    // SP5: economicModel rides on the macroMetrics doc.
    await db.collection<StateMetrics>("macroMetrics").bulkWrite(ops);
  }
  // regionsProcessed retained in the return shape for the phase logger; the model is
  // national-only now, so no regional docs are written.
  return { regionsProcessed: 0, countriesProcessed };
}
