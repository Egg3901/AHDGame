/**
 * Seed-time metrics extractor.
 *
 * Was the SP5 SPLITTER: it cut an assembled legacy doc into a macro slice for
 * `macroMetrics` and a political remainder for `stateMetrics`. Step-6 Phase 3
 * removed the second half — every seeded country has a political board, so a
 * legacy political doc would be written and never read. What remains is the
 * macro extraction, which every country still needs.
 *
 * The political categories are still enumerated below, but only to say what
 * gets DROPPED. Two `governance` fields are exceptions and ride the macro doc:
 * `independenceDesire` (mechanic state owned by its drift phase) and the
 * objective fiscal pair (see MACRO_GOVERNANCE_PATHS) — dropping those would
 * silently kill the independence mechanic and the national budget sync.
 */
import type { Db } from "mongodb";
import type { StateMetrics } from "@/lib/db/types";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import { MACRO_CATEGORIES } from "./paths";

/**
 * Everything the political BOARD now owns, and which this extractor therefore
 * drops. Exported for the guard test: a category that gains a legacy seed but
 * no board family would vanish from the game with nothing to notice.
 */
export const DROPPED_POLITICAL_CATEGORIES = [
  "education",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "environment",
  "social",
  "governance",
  "mediaInformation",
] as const;

export interface SplitMetricsResult {
  macro: MacroMetricsDoc;
}

/** Extract the macro half of a legacy-shaped seed doc. */
export function splitMetricsDoc(doc: StateMetrics): SplitMetricsResult {
  const macro: MacroMetricsDoc = {
    _id: doc._id,
    ...(doc.countryId != null ? { countryId: doc.countryId } : {}),
    economic: { ...(doc.economic ?? {}) } as MacroMetricsDoc["economic"],
    population: { ...(doc.population ?? {}) } as MacroMetricsDoc["population"],
    lastUpdated: doc.lastUpdated ?? new Date(),
  };

  const independenceDesire = doc.governance?.independenceDesire;
  if (independenceDesire != null) macro.independenceDesire = independenceDesire;

  // Objective fiscal state rides with the macro half — see MACRO_GOVERNANCE_PATHS.
  const fiscal: Record<string, unknown> = {};
  for (const metricId of ["budgetBalance", "debtToGdp"] as const) {
    const v = (doc.governance as Record<string, unknown> | undefined)?.[metricId];
    if (v != null) fiscal[metricId] = v;
  }
  if (Object.keys(fiscal).length > 0) {
    macro.governance = fiscal as MacroMetricsDoc["governance"];
  }

  if (doc.economicModel != null) macro.economicModel = doc.economicModel;
  return { macro };
}

/** Shared seeder write helper: upsert the macro doc. */
export async function writeSplitMetrics(db: Db, doc: StateMetrics): Promise<void> {
  await writeSplitMetricsBulk(db, [doc]);
}

/**
 * Batched {@link writeSplitMetrics} — one round trip for a country's whole
 * region bundle instead of one per region.
 *
 * This was the single largest write site in the reset: 231 round trips measured
 * across 22 per-country seeders, each looping `await writeSplitMetrics` over its
 * bundle. Nothing about the per-doc work changed; only the number of trips.
 *
 * ⚠️ `ordered: true`, matching the C1 batching precedent rather than the repo's
 * usual `ordered: false`. It preserves the old semantics exactly: same
 * application order, and a failure still skips the remainder the way a thrown
 * await did. Unordered would keep going after a failure.
 */
export async function writeSplitMetricsBulk(db: Db, docs: StateMetrics[]): Promise<void> {
  if (docs.length === 0) return;
  const ops = docs.map((doc) => {
    const { macro } = splitMetricsDoc(doc);
    const { _id: macroId, ...macroData } = macro;
    return {
      updateOne: { filter: { _id: macroId }, update: { $set: macroData }, upsert: true },
    };
  });
  await db.collection<MacroMetricsDoc>("macroMetrics").bulkWrite(ops as never, { ordered: true });
}

export { MACRO_CATEGORIES };
