/**
 * Proportional chamber seat allocation for era presets whose legislatures
 * start vacant (1953/1979 democracies). Replaces the old uniform "1 seat per
 * major party per region" filler that never checked the sum against
 * `totalSeats` and — combined with the deputy/cameraDeputati office-type
 * split — produced the UK 806≠650 and IT 945≠630 audit mismatches.
 *
 * Algorithm: scale each region's authored magnitude so the national total
 * equals `targetSeats` (largest-remainder), then allocate each region's seats
 * across parties by weight (also largest-remainder). Guarantees
 * Σ seatsHeld === targetSeats.
 */
import type { HistoricalSeat } from "@/lib/constants/historicalSeats";
import { allocateSeatsByWeights } from "@/lib/sim/backfillMissingSeats";

export interface ChamberRegion {
  id: string;
  /** Authored magnitude (houseDistricts / stateSenateSeats). May not yet sum to target. */
  seats: number;
}

export interface ChamberPartyWeight {
  name: string;
  weight: number;
}

export interface BuildProportionalChamberSeatsArgs {
  officeType: string;
  regions: ChamberRegion[];
  parties: ChamberPartyWeight[];
  /** Configured chamber size — the allocation MUST sum to this. */
  targetSeats: number;
}

/** Sum `seatsHeld` (defaulting missing to 1) across a HistoricalSeat list. */
export function sumSeatsHeld(seats: readonly HistoricalSeat[]): number {
  return seats.reduce((n, s) => n + (s.seatsHeld ?? 1), 0);
}

/**
 * Largest-remainder scale of region magnitudes so they sum exactly to `target`.
 * Regions with authored seats ≤ 0 are dropped.
 */
export function scaleRegionSeatsToTarget(
  regions: ChamberRegion[],
  target: number
): ChamberRegion[] {
  const positive = regions.filter((r) => r.seats > 0);
  if (target <= 0 || positive.length === 0) return [];
  const authored = positive.reduce((n, r) => n + r.seats, 0);
  if (authored === target) return positive.map((r) => ({ ...r }));

  const weights = new Map(positive.map((r) => [r.id, r.seats]));
  const scaled = allocateSeatsByWeights(target, weights);
  return positive
    .map((r) => ({ id: r.id, seats: scaled.get(r.id) ?? 0 }))
    .filter((r) => r.seats > 0);
}

/**
 * Build a full-chamber HistoricalSeat roster: every region × party bloc that
 * received ≥1 seat, with seatsHeld set so the national total equals
 * `targetSeats`. Party weights of 0 are excluded (regional parties stay home
 * when the caller omits them from a region — pass per-region party lists if
 * needed; this helper uses one national weight vector for all regions).
 */
export function buildProportionalChamberSeats(
  args: BuildProportionalChamberSeatsArgs
): HistoricalSeat[] {
  const { officeType, parties, targetSeats } = args;
  const regions = scaleRegionSeatsToTarget(args.regions, targetSeats);
  const partyWeights = new Map(parties.filter((p) => p.weight > 0).map((p) => [p.name, p.weight]));
  if (regions.length === 0 || partyWeights.size === 0 || targetSeats <= 0) return [];

  const out: HistoricalSeat[] = [];
  for (const region of regions) {
    const byParty = allocateSeatsByWeights(region.seats, partyWeights);
    for (const [party, count] of byParty) {
      if (count <= 0) continue;
      out.push({
        state: region.id,
        officeType: officeType as HistoricalSeat["officeType"],
        party,
        seatsHeld: count,
      });
    }
  }
  return out;
}
