/**
 * Extraction-only resource capacity context for the sector detail query.
 * Extracted verbatim from sectorDetail.ts (pure code motion; no behavior
 * change).
 */
import type { Db } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { activeExtractionContractFilter } from "@/lib/db/collections/extractionContracts";
import {
  computeExtractionCapacityMultipliers,
  type ExtractionSectorInput,
} from "@/lib/turn/extraction/extractionCapacity";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import {
  getSectorHostFxRate,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { COMMODITY_BASE_PRICES, EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";

export async function computeSectorExtractionCapacityContext(
  db: Db,
  sector: CorporateSector,
  sectorType: CorporationType
) {
  // ── Extraction-only: resource capacity and per-resource multipliers ──
  // Must be computed before supply flows so stateResources is available
  // for capacity filtering and thisSectorMultipliers for the supplies map.
  let stateResources: Partial<Record<ExtractableResource, number>> | null | undefined = undefined;
  let thisSectorMultipliers: Partial<Record<ExtractableResource, number>> = {};
  // Strategy-picker preview (turn-899 misallocation finding): per candidate
  // strategy, THIS sector's capacity multipliers if it retooled — so the
  // projected ₳/turn reflects that a huge oil rate is worthless in a state
  // with a trivial oil deposit. null = no cap doc (uncapped legacy state).
  let strategyCapacityMultipliers: Map<
    string,
    Partial<Record<ExtractableResource, number>>
  > | null = null;
  // Total desired (unconstrained) output per resource across ALL extraction
  // sectors in this state — feeds the deposit cap/desired/headroom view.
  const extractionDesiredByResource: Partial<Record<ExtractableResource, number>> = {};

  if (sectorType === "extraction") {
    const capDoc = await db
      .collection<StateResourceCapacity>("stateResourceCapacity")
      .findOne({ stateId: sector.stateId }, { projection: { stateId: 1, resources: 1 } });

    // undefined = no cap doc at all (uncapped); null = cap doc exists but has no
    // resources field; Partial<Record> = cap doc with resource data.
    stateResources = capDoc ? (capDoc.resources ?? null) : undefined;

    if (capDoc) {
      const [extractionContracts, allStateSectors] = await Promise.all([
        db
          .collection<ExtractionContract>("extractionContracts")
          .find({ stateId: sector.stateId, ...activeExtractionContractFilter() })
          .toArray(),
        db
          .collection<CorporateSector>("corporateSectors")
          .find({ stateId: sector.stateId, sectorType: "extraction" })
          .project({ _id: 1, corporationId: 1, stateId: 1, revenue: 1, strategyId: 1 })
          .toArray(),
      ]);

      // Every sector here operates in `sector.stateId`, so they share the host
      // state's currency. Sector revenue is stored in that currency; normalize it
      // to ₳ — the unit COMMODITY_BASE_PRICES and the capacity allocator use — at
      // the host rate before the per-resource output math. (Fixes both the
      // host-vs-owner denomination and the prior local-as-₳ approximation.)
      const hostCode = resolveSectorHostCurrencyCode(sector, null);
      const hostRate = await getSectorHostFxRate(db, sector, null);
      const revenueAnchorOf = (rev: number): number =>
        readCorpEconomicAnchor(rev, hostCode, hostRate);

      const sectorInputs: ExtractionSectorInput[] = (
        allStateSectors as Pick<
          CorporateSector,
          "_id" | "corporationId" | "stateId" | "revenue" | "strategyId"
        >[]
      ).map((s) => {
        const strat =
          SECTOR_STRATEGIES["extraction"]?.find((st) => st.id === (s.strategyId ?? "standard")) ??
          SECTOR_STRATEGIES["extraction"]?.[0];
        const supplyRates = (strat?.supply ?? {}) as Partial<Record<string, number>>;
        const revenueBasedOutput: Partial<Record<ExtractableResource, number>> = {};
        for (const resource of EXTRACTABLE_RESOURCES) {
          const rate = supplyRates[resource] ?? 0;
          if (rate > 0) {
            revenueBasedOutput[resource] =
              (revenueAnchorOf(s.revenue) * rate) /
              (COMMODITY_BASE_PRICES[resource as keyof typeof COMMODITY_BASE_PRICES] ?? 1);
          }
        }
        return {
          sectorId: s._id.toString(),
          stateId: s.stateId,
          corporationId: s.corporationId,
          revenueBasedOutput,
        };
      });

      const multiplierMap = computeExtractionCapacityMultipliers(
        sectorInputs,
        extractionContracts,
        [capDoc]
      );
      thisSectorMultipliers = multiplierMap.get(sector._id.toString()) ?? {};

      // Aggregate state-wide desired output per resource (cap vs. demand).
      for (const input of sectorInputs) {
        for (const [resource, output] of Object.entries(input.revenueBasedOutput)) {
          const key = resource as ExtractableResource;
          extractionDesiredByResource[key] =
            (extractionDesiredByResource[key] ?? 0) + (output ?? 0);
        }
      }

      // Per-candidate-strategy multipliers: swap THIS sector's output for
      // what it would produce under each strategy, re-run the shared
      // allocator, and keep the focal sector's multipliers. Contracts and
      // competitor outputs are held fixed — a read-only what-if.
      if (stateResources) {
        strategyCapacityMultipliers = new Map();
        const focalId = sector._id.toString();
        for (const strat of SECTOR_STRATEGIES["extraction"] ?? []) {
          const supplyRates = (strat.supply ?? {}) as Partial<Record<string, number>>;
          const candidateOutput: Partial<Record<ExtractableResource, number>> = {};
          for (const resource of EXTRACTABLE_RESOURCES) {
            const rate = supplyRates[resource] ?? 0;
            if (rate > 0) {
              candidateOutput[resource] =
                (revenueAnchorOf(sector.revenue) * rate) /
                (COMMODITY_BASE_PRICES[resource as keyof typeof COMMODITY_BASE_PRICES] ?? 1);
            }
          }
          const candidateInputs = sectorInputs.map((input) =>
            input.sectorId === focalId ? { ...input, revenueBasedOutput: candidateOutput } : input
          );
          const candidateMap = computeExtractionCapacityMultipliers(
            candidateInputs,
            extractionContracts,
            [capDoc]
          );
          strategyCapacityMultipliers.set(strat.id, candidateMap.get(focalId) ?? {});
        }
      }
    }
  }
  return {
    stateResources,
    thisSectorMultipliers,
    strategyCapacityMultipliers,
    extractionDesiredByResource,
  };
}
