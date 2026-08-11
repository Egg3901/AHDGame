/**
 * Read-time projection of a region's macro doc into the LEGACY doc shape.
 *
 * This was SP5's two-store combiner: it loaded the political half from
 * `stateMetrics` and the macro half from `macroMetrics` and glued them back
 * together, so consumers written against the single legacy doc kept working
 * across the split. Step-6 Phase 3 retired the political half — every country
 * is on the board now — so there is only one store left to read and the
 * "merge" is a shape adapter.
 *
 * The LEGACY SHAPE ITSELF STAYS. `StateMetrics` is still the read model this
 * returns, and dozens of display consumers destructure `economic` /
 * `population` / `governance` off it. What went away is the second collection,
 * not the interface.
 *
 * Political values are deliberately NOT projected in here. A consumer that
 * wants them asks for them explicitly via
 * `macroMetrics/displayMerge#findMergedRegionMetricsForDisplay` — folding the
 * board in unconditionally double-counted it for approval scorers, which
 * already take the board through `baseOverride` (measured at +4 to +5 approval
 * points).
 */
import type { Db, Filter } from "mongodb";
import type { StateMetrics } from "@/lib/db/types";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";

/** findOne the macro store and project it to the legacy shape. */
export async function findMergedRegionMetrics(
  db: Db,
  filter: Record<string, unknown>
): Promise<StateMetrics | null> {
  const macro = await db
    .collection<MacroMetricsDoc>("macroMetrics")
    .findOne(filter as Filter<MacroMetricsDoc>);
  return mergeRegionMetrics(macro);
}

/** find the macro store and project each region to the legacy shape. */
export async function findMergedRegionMetricsMany(
  db: Db,
  filter: Record<string, unknown>
): Promise<StateMetrics[]> {
  const macro = await db
    .collection<MacroMetricsDoc>("macroMetrics")
    .find(filter as Filter<MacroMetricsDoc>)
    .toArray();
  return macro
    .map((doc) => mergeRegionMetrics(doc))
    .filter((doc): doc is StateMetrics => doc != null);
}

export function mergeRegionMetrics(macro: MacroMetricsDoc | null): StateMetrics | null {
  if (!macro) return null;

  const base: Record<string, unknown> = { _id: macro._id, lastUpdated: macro.lastUpdated };
  if (macro.countryId != null) base.countryId = macro.countryId;

  base.economic = macro.economic ?? {};
  base.population = macro.population ?? {};
  if (macro.economicModel != null) base.economicModel = macro.economicModel;
  // Put the macro-side governance fields back where consumers expect them:
  // `independenceDesire` (mechanic state) and the objective fiscal pair, which
  // ride the macro doc but are read off `governance` by every consumer.
  const hoisted: Record<string, unknown> = {};
  if (macro.independenceDesire != null) hoisted.independenceDesire = macro.independenceDesire;
  for (const [k, v] of Object.entries(macro.governance ?? {})) {
    if (v != null) hoisted[k] = v;
  }
  if (Object.keys(hoisted).length > 0) base.governance = hoisted;

  return base as unknown as StateMetrics;
}
