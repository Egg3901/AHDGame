/**
 * World Events v1 Phase 1: batch-loads all currently-active
 * `sectorDemandModifier` docs (written by `applyCountryEffects` in
 * `substrate/applyEffects.ts`) into a single `${countryId}:${sectorType}`
 * lookup map for `computeRawSupplyDemand`. One query per turn instead of a
 * per-country call to `getActiveSectorDemandModifierPct` — the commodity
 * pricing turn phase already iterates every sector once, so a single
 * pre-loaded map is the cheaper shape here.
 */
import type { Db } from "mongodb";
import { getCountryModifiersCollection } from "@/lib/db/collections/countryModifiers";

/**
 * World Events v1 Phase 4: total cap on summed sectorDemandModifier pct per
 * (country, sector), per plan §7 ("additive pct with a total cap, validated
 * in sim"). Worst-case overlap observed across the whole catalog is Olympics
 * host + royalEvent on "entertainment" (8% + 5% = 13%, UK-only) and
 * worlds-fair host + scientificBreakthrough on "technology" (5% + 6% = 11%)
 * — sim_economy_whatif projects both as bounded single-digit-to-low-teens
 * price moves with no runaway inflation (see Phase 4 handoff). This cap is
 * headroom above that observed worst case, not a response to an observed
 * blowup — it exists so a future catalog addition can't silently stack past
 * a sane bound without a test failing first.
 */
export const SECTOR_DEMAND_MODIFIER_TOTAL_CAP_PCT = 20;

export async function loadActiveSectorDemandModifierPctMap(
  db: Db,
  currentTurn: number
): Promise<Map<string, number>> {
  // No `.project()` here (deliberately) — this collection is queried by only
  // one other caller (`sweepExpiredCountryModifiers`), and several turn-phase
  // test mocks (e.g. commodityPriceTurn.test.ts's fallback collection stub)
  // only chain `.find().toArray()`. Projecting client-side keeps this helper
  // usable against that shape without adding a `.project` mock everywhere.
  const modifiers = await getCountryModifiersCollection(db)
    .find({
      kind: "sectorDemandModifier",
      expiresAtTurn: { $gt: currentTurn },
    })
    .toArray();

  const map = new Map<string, number>();
  for (const m of modifiers) {
    // `sectorType` also keeps pre-discriminator rows and older test fixtures
    // readable while excluding war-emergency mitigation rows.
    if (!("sectorType" in m)) continue;
    const key = `${m.countryId}:${m.sectorType}`;
    map.set(key, (map.get(key) ?? 0) + m.pct);
  }
  for (const [key, pct] of map) {
    const clamped = Math.max(
      -SECTOR_DEMAND_MODIFIER_TOTAL_CAP_PCT,
      Math.min(SECTOR_DEMAND_MODIFIER_TOTAL_CAP_PCT, pct)
    );
    if (clamped !== pct) map.set(key, clamped);
  }
  return map;
}

/**
 * Batch-load output-demand shifts. Unlike `sectorDemandModifier`, these move
 * demand for what the sector sells, so positive values improve seller margins
 * and negative values depress them.
 */
export async function loadActiveSectorOutputDemandModifierPctMap(
  db: Db,
  currentTurn: number
): Promise<Map<string, number>> {
  const modifiers = await getCountryModifiersCollection(db)
    .find({
      kind: "sectorOutputDemandModifier",
      expiresAtTurn: { $gt: currentTurn },
    })
    .toArray();

  const map = new Map<string, number>();
  for (const modifier of modifiers) {
    if (modifier.kind !== "sectorOutputDemandModifier") continue;
    const key = `${modifier.countryId}:${modifier.sectorType}`;
    map.set(key, (map.get(key) ?? 0) + modifier.pct);
  }
  for (const [key, pct] of map) {
    map.set(
      key,
      Math.max(
        -SECTOR_DEMAND_MODIFIER_TOTAL_CAP_PCT,
        Math.min(SECTOR_DEMAND_MODIFIER_TOTAL_CAP_PCT, pct)
      )
    );
  }
  return map;
}
