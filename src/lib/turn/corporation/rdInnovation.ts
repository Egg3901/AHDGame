import { ObjectId } from "mongodb";
import type { CorporationLookups } from "./types";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import {
  RD_INNOVATION_INTERVAL,
  RD_INNOVATION_SCORE_THRESHOLD,
  RD_EXTRACTION_BOOST_MIN,
  RD_EXTRACTION_BOOST_MAX,
  RD_REGULAR_BOOST_MIN,
  RD_REGULAR_BOOST_MAX,
  RD_CAPACITY_BOOST_MIN_PCT,
  RD_CAPACITY_BOOST_MAX_PCT,
} from "@/lib/constants/corporations";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { createNotifications } from "@/lib/notifications";

// PLANTS-GATED: under plants a breakthrough raises `capitalStock` by the same
// proportion the legacy path raised `revenue`; the revenue write below runs only
// below the plants tier, where revenue is still the authoritative quantity.
/**
 * Result of processing R&D innovations for all corporations in one turn.
 * Used to collect bulk write operations for sector revenue boosts and
 * state resource capacity updates.
 */
export interface RdInnovationResult {
  /** Bulk ops for sector revenue boosts (corporateSectors collection) */
  sectorBoostOps: {
    updateOne: {
      filter: { _id: ObjectId };
      update: { $inc: Record<string, number>; $set: Record<string, unknown> };
    };
  }[];
  /** Bulk ops for state resource capacity boosts (stateResourceCapacity collection) */
  capacityBoostOps: {
    updateOne: {
      filter: { stateId: string };
      update: { $inc: Record<string, number>; $set: Record<string, unknown> };
    };
  }[];
  /** Number of innovations that triggered this turn */
  innovationsTriggered: number;
}

/**
 * Return every extractable resource produced by a sector's active strategy
 * along with its supply rate. Callers weight per-resource capacity boosts by
 * the returned supply rate so `oil_gas` splits growth across oil + natural
 * gas (not just the single highest-supply resource).
 */
function getStrategyExtractableResources(
  sectorType: string,
  strategyId: string | undefined
): Array<{ resource: ExtractableResource; supply: number }> {
  const strategies = SECTOR_STRATEGIES[sectorType as keyof typeof SECTOR_STRATEGIES];
  if (!strategies) return [];

  const strategy = strategyId
    ? strategies.find((s) => s.id === strategyId)
    : strategies.find((s) => s.id === "standard");
  if (!strategy) return [];

  const out: Array<{ resource: ExtractableResource; supply: number }> = [];
  for (const resource of EXTRACTABLE_RESOURCES) {
    const supply = (strategy.supply as Partial<Record<string, number>>)[resource] ?? 0;
    if (supply > 0) out.push({ resource, supply });
  }
  return out;
}

/**
 * Process R&D innovations for all corporations.
 * Fires every RD_INNOVATION_INTERVAL turns.
 *
 * Innovation probability = min(1, rdScore / RD_INNOVATION_SCORE_THRESHOLD).
 * At score 200, innovation is guaranteed. At 100, 50%. At 0, no chance.
 *
 * Extraction corps (type === "extraction"):
 *   - Pick a random sector, boost its revenue by 1–5% (scaling with rdScore)
 *   - Boost every extractable resource in the sector's active strategy supply
 *     map, weighted by supply rate, so diversified strategies spread the
 *     capacity increase across resources they actually produce (Q4).
 *
 * Regular corps (all other types):
 *   - Pick a random sector, boost its revenue by 1–10% (floor mirrors
 *     extraction so breakthroughs always feel meaningful).
 *
 * All boosts are permanent revenue increases applied as $inc on the sector
 * document. State resource capacity grows unboundedly by design (Q3 — "R&D
 * unlocks new deposits"); the docs/design call records this policy.
 * Notifications are sent to the CEO's user for each breakthrough.
 */
export function processRdInnovations(
  lookups: CorporationLookups,
  turn: number,
  now: Date,
  // Injectable [0,1) source, same pattern as decideNppAction
  // (src/lib/npp/actionAi.ts) — defaults to Math.random, read at call time so
  // `vi.spyOn(Math, "random")` in existing tests keeps working unchanged.
  // The turn-path caller passes a seeded stream instead (see
  // turnPhaseRegistry.ts) per the "never Math.random() in turn paths"
  // doctrine (src/lib/events/substrate/rng.ts).
  rng: () => number = Math.random,
  /**
   * `marketSystemMode >= "plants"`. Under plants the turn processor RESTATES
   * `sector.revenue` from `capitalStock × mixPrice` every turn, so a `$inc` on
   * revenue is erased on the next tick — the breakthrough would simply not
   * happen. The boost is therefore applied to `capitalStock` instead (see the
   * write below). Defaults to false so every non-plants caller and every
   * existing test keeps the legacy revenue behaviour byte-identical.
   */
  plantsEnabled: boolean = false
): RdInnovationResult {
  const sectorBoostOps: RdInnovationResult["sectorBoostOps"] = [];
  const capacityBoostOps: RdInnovationResult["capacityBoostOps"] = [];
  let innovationsTriggered = 0;

  if (turn % RD_INNOVATION_INTERVAL !== 0) {
    return { sectorBoostOps, capacityBoostOps, innovationsTriggered: 0 };
  }

  // stateId → resource → accumulated units. Multiple extraction breakthroughs
  // in the same state stack before writing to avoid $inc op collisions.
  const capacityBoostsByState = new Map<string, Partial<Record<ExtractableResource, number>>>();

  for (const corp of lookups.corporations) {
    const rdScore = corp.rdScore ?? 0;
    if (rdScore <= 0) continue;

    const probability = Math.min(1, rdScore / RD_INNOVATION_SCORE_THRESHOLD);
    if (rng() > probability) continue;

    const sectors = lookups.sectorsByCorp.get(corp._id.toString()) ?? [];
    if (sectors.length === 0) continue;

    const isExtraction = corp.type === "extraction";

    // For extraction corps, prefer the sector closest to capacity — R&D capacity
    // boosts are most valuable where extraction is already constrained. Missing
    // utilization entry = unconstrained (treated as 1.0). Fall back to random
    // for non-extraction corps where capacity is irrelevant.
    let sector;
    if (isExtraction) {
      sector = [...sectors].sort((a, b) => {
        const ua = lookups.extractionCapacityUtilBySector.get(a._id.toString())?.utilization ?? 1;
        const ub = lookups.extractionCapacityUtilBySector.get(b._id.toString())?.utilization ?? 1;
        return ub - ua;
      })[0];
    } else {
      sector = sectors[Math.floor(rng() * sectors.length)];
    }

    // Magnitude is uniformly random across [MIN, MAX] — rdScore only governs
    // how often a breakthrough fires (the probability check above), not how
    // big it is. Prior behavior used scoreFraction interpolation which made
    // high-rdScore corps a guaranteed cap-hit; that turned R&D into a strictly
    // dominant strategy over Growth (see bug discussion 2026-05-19).
    const magnitudeRoll = rng();
    const boostPercent = isExtraction
      ? RD_EXTRACTION_BOOST_MIN +
        magnitudeRoll * (RD_EXTRACTION_BOOST_MAX - RD_EXTRACTION_BOOST_MIN)
      : RD_REGULAR_BOOST_MIN + magnitudeRoll * (RD_REGULAR_BOOST_MAX - RD_REGULAR_BOOST_MIN);

    // sector.revenue is persisted in the corp's local currency post-v0.2.6.
    // boostPercent is unitless, so boostAmount is already local — the $inc on
    // corporateSectors.revenue takes local. No FX conversion needed here
    // (prior code wrapped anchorToCorpCapital and inflated JP/UK boosts by
    // the corp's FX rate — ~150× for JPY).
    const boostAmount = sector.revenue * boostPercent;

    if (plantsEnabled) {
      // PLANTS: the breakthrough is new PLANT, not a revenue nameplate.
      //
      // Under plants the identity is `revenue = capitalStock × mixPrice`, and
      // the turn processor rewrites `revenue` from that product every turn. The
      // revenue boost the legacy branch applies is therefore erased on the next
      // tick. Converting it back into units is exact and needs no currency work
      // at all: deltaUnits = boostAmount / mixPrice = (revenue × boostPercent) /
      // mixPrice = capitalStock × boostPercent. So the same percentage applied
      // to the STOCK reproduces the intended boost, in units, with no FX and no
      // RPU lookup — and it stays correct if the sector later retools (D9
      // rescales the stock, and a percentage of a rescaled stock is still the
      // same fraction of the nameplate).
      //
      // FREE capacity, with no `buildQueue` entry and no `costPaidAnchor`: a
      // breakthrough is exactly the case where capacity arrives without being
      // bought, so there is no CIP to recognise and nothing to refund.
      //
      // A sector with no stock yet (pre-flip, or a mothballed shell that never
      // had capacity) is skipped: there is no plant for the lab to improve, and
      // seeding one here would conjure capacity from a percentage of zero on
      // the flip turn instead.
      const stock =
        typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
          ? sector.capitalStock
          : 0;
      const deltaCapacity = stock * boostPercent;
      if (deltaCapacity <= 0) continue;

      sectorBoostOps.push({
        updateOne: {
          filter: { _id: sector._id },
          update: {
            $inc: { capitalStock: Math.round(deltaCapacity * 100) / 100 },
            $set: { updatedAt: now },
          },
        },
      });
    } else {
      if (boostAmount <= 0) continue;

      sectorBoostOps.push({
        updateOne: {
          filter: { _id: sector._id },
          update: {
            $inc: { revenue: Math.round(boostAmount) },
            $set: { updatedAt: now },
          },
        },
      });
    }
    innovationsTriggered++;

    // Extraction-specific: grow the state's per-resource capacity for every
    // extractable in the sector's strategy supply, weighted by supply rate.
    // Only applies to states that already have a cap doc — "uncapped" legacy
    // states don't need boosts and we don't auto-create docs mid-turn.
    if (isExtraction) {
      const strategyResources = getStrategyExtractableResources(
        sector.sectorType,
        sector.strategyId
      );
      const hasCapDoc = lookups.stateResourceCapacityByState.get(sector.stateId) !== undefined;
      if (strategyResources.length > 0 && hasCapDoc) {
        const capResources = lookups.stateResourceCapacityByState.get(sector.stateId) ?? {};
        const existing = capacityBoostsByState.get(sector.stateId) ?? {};
        for (const { resource } of strategyResources) {
          const currentCap = capResources[resource] ?? 0;
          if (currentCap <= 0) continue;
          const pct =
            RD_CAPACITY_BOOST_MIN_PCT +
            rng() * (RD_CAPACITY_BOOST_MAX_PCT - RD_CAPACITY_BOOST_MIN_PCT);
          const increase = Math.round(currentCap * pct);
          if (increase > 0) {
            existing[resource] = (existing[resource] ?? 0) + increase;
          }
        }
        if (Object.keys(existing).length > 0) {
          capacityBoostsByState.set(sector.stateId, existing);
        }
      }
    }

    // Notify the CEO's user (corp.userId == CEO's user per requireCeo
    // convention — transfers update both together).
    if (corp.ceoId && !corp.ceoVacant) {
      const boostDisplayPercent = Math.round(boostPercent * 100);
      const title = "R&D Breakthrough!";
      const message = isExtraction
        ? `Your R&D investment has led to a technological breakthrough! A sector in ${sector.stateId} saw a ${boostDisplayPercent}% revenue increase and expanded state resource capacity.`
        : `Your R&D investment has led to an innovation! A sector in ${sector.stateId} saw a ${boostDisplayPercent}% revenue boost.`;

      void createNotifications([
        {
          userId: corp.userId,
          type: "rd_breakthrough",
          title,
          message,
          metadata: {
            corporationId: corp._id.toString(),
            sectorId: sector._id.toString(),
            stateId: sector.stateId,
            boostPercent: boostDisplayPercent,
            boostType: isExtraction ? "extraction" : "regular",
            rdScore,
            turn,
          },
        },
      ]);
    }
  }

  // Emit one $inc per (state, resource) pair — per-resource increments are
  // independent, so a single updateOne per state with multiple $inc keys works
  // but we stay one-op-per-resource for clarity with the existing pattern.
  for (const [stateId, resources] of capacityBoostsByState) {
    const inc: Record<string, number> = {};
    for (const [resource, amount] of Object.entries(resources)) {
      if (amount && amount > 0) inc[`resources.${resource}`] = amount;
    }
    if (Object.keys(inc).length > 0) {
      capacityBoostOps.push({
        updateOne: {
          filter: { stateId },
          update: {
            $inc: inc,
            $set: { updatedAt: now },
          },
        },
      });
    }
  }

  return { sectorBoostOps, capacityBoostOps, innovationsTriggered };
}
