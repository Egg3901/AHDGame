import type { Db } from "mongodb";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import type { ExtractionSectorInput } from "@/lib/turn/extraction/extractionCapacity";
import { buildDepletionInc } from "@/lib/extraction/depletion";

/**
 * P3b — book this turn's extraction against each state's deposits (plants only).
 *
 * Produced units per (state, resource) are the rationed output the multipliers
 * just resolved, summed over the state's sectors, so the ground gives up
 * precisely what the world receives.
 *
 * ACCURACY: `revenueBasedOutput` derives from `sector.revenue`, which under
 * plants is the CAPACITY NAMEPLATE, not realized output — booking against it
 * omits `plantsExtractionHardMin`'s ramp lambda, the throughput factor and the
 * revenue multiplier, so during the ramp the ground was debited for more ore
 * than was actually mined. When the sector has a persisted `producedUnits`
 * (written only under plants) we scale the per-resource nameplate split by
 * realized ÷ nameplate instead: the resource MIX still comes from the nameplate
 * split (producedUnits is a single scalar across the sector's whole mix), but
 * the LEVEL is the realized one. Below plants `producedUnits` is never written,
 * so the fallback keeps the old derivation byte-identical.
 *
 * One `$inc` per state, on the monotonic `extractedUnits` counter — no read-
 * modify-write, so concurrent turn phases cannot lose extraction.
 *
 * Matched on `stateId` alone, deliberately consistent with the read side
 * (`capacityDocs` is fetched by stateId and
 * `computeExtractionCapacityMultipliers` keys by stateId): the rationing this
 * books against already resolves a cross-country state-id collision to one
 * doc, and the write must land on the same one it rationed with.
 */
export async function bookExtractionDepletion(
  db: Db,
  inputs: ReadonlyArray<ExtractionSectorInput>,
  multipliers: Map<string, Partial<Record<ExtractableResource, number>>>,
  now: Date,
  /**
   * sectorId → realized ÷ nameplate output. 1 (or absent) means "no realized
   * measurement for this sector", which is the pre-plants case and keeps the
   * booking identical to the nameplate derivation.
   */
  realizedFractionBySectorId?: ReadonlyMap<string, number>
): Promise<void> {
  const producedByState = new Map<string, Partial<Record<ExtractableResource, number>>>();
  for (const input of inputs) {
    const mult = multipliers.get(input.sectorId);
    const realizedFraction = realizedFractionBySectorId?.get(input.sectorId) ?? 1;
    const acc = producedByState.get(input.stateId) ?? {};
    for (const resource of Object.keys(input.revenueBasedOutput) as ExtractableResource[]) {
      const potential = input.revenueBasedOutput[resource] ?? 0;
      if (!(potential > 0)) continue;
      const produced = potential * (mult?.[resource] ?? 1) * realizedFraction;
      if (produced > 0) acc[resource] = (acc[resource] ?? 0) + produced;
    }
    producedByState.set(input.stateId, acc);
  }
  const ops = [];
  for (const [stateId, produced] of producedByState) {
    const inc = buildDepletionInc(produced);
    if (Object.keys(inc).length === 0) continue;
    ops.push({
      updateOne: { filter: { stateId }, update: { $inc: inc, $set: { updatedAt: now } } },
    });
  }
  if (ops.length === 0) return;
  const col = await getStateResourceCapacityCollection(db);
  await col.bulkWrite(ops as Parameters<typeof col.bulkWrite>[0]);
}
