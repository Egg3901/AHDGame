// GET — state resource capacity + active contracts + current extraction output
// Public read — used by state page Resources tab

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { activeExtractionContractFilter } from "@/lib/db/collections/extractionContracts";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { Corporation } from "@/lib/db/types/corporation";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { isProspectingEnabled, isContractIssuanceEnabled } from "@/lib/extraction/featureFlag";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: stateId } = await params;
    const db = await getDb();

    const stateSupplyKey = `stateSupply.${stateId}` as const;

    const [capacityDoc, contracts, commodityPrices, config] = await Promise.all([
      db.collection<StateResourceCapacity>("stateResourceCapacity").findOne({ stateId }),
      db
        .collection<ExtractionContract>("extractionContracts")
        .find({ stateId, ...activeExtractionContractFilter() })
        .toArray(),
      db
        .collection<CommodityPrice>("commodityPrices")
        .find(
          { commodity: { $in: [...EXTRACTABLE_RESOURCES] }, [stateSupplyKey]: { $exists: true } },
          { projection: { commodity: 1, turn: 1, [stateSupplyKey]: 1 } }
        )
        .sort({ turn: -1 })
        .toArray(),
      db
        .collection<GameConfig>("gameConfig")
        .findOne(
          { _id: "default" },
          { projection: { prospectingEnabled: 1, contractIssuanceEnabled: 1 } }
        ),
    ]);

    const capacity = capacityDoc?.resources ?? {};

    const currentOutput: Partial<Record<ExtractableResource, number>> = {};
    for (const priceDoc of commodityPrices) {
      const resource = priceDoc.commodity as ExtractableResource;
      if (currentOutput[resource] !== undefined) continue;
      currentOutput[resource] = priceDoc.stateSupply?.[stateId] ?? 0;
    }

    const summary = EXTRACTABLE_RESOURCES.map((resource) => {
      const cap = capacity[resource] ?? 0;
      const resourceContracts = contracts.filter((c) => c.resource === resource);
      const contractedShare = resourceContracts.reduce((sum, c) => sum + (c.share ?? 0), 0);
      const openAccessPct = Math.max(0, 1 - contractedShare);
      return {
        resource,
        capacityPerTurn: cap,
        contractedPct: Math.min(1, contractedShare),
        openAccessPct,
        overAllocated: contractedShare > 1,
        currentOutput: currentOutput[resource] ?? 0,
      };
    }).filter((r) => r.capacityPerTurn > 0 || r.currentOutput > 0);

    const corpIds = [...new Set(contracts.map((c) => c.corporationId as ObjectId))];
    const corporations =
      corpIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: corpIds } }, { projection: { name: 1 } })
            .toArray()
        : [];
    const corpNames = new Map(corporations.map((c) => [c._id.toString(), c.name]));

    return NextResponse.json({
      stateId,
      // Per-surface flag convention: the Resources tab reads both gates off its
      // own payload (prospect + issue-contract actions for governors).
      prospectingEnabled: await isProspectingEnabled(config),
      contractIssuanceEnabled: await isContractIssuanceEnabled(config),
      summary,
      contracts: contracts.map((c) => {
        const id = (c.corporationId as ObjectId).toString();
        return {
          ...c,
          _id: c._id.toString(),
          corporationId: id,
          corporationName: corpNames.get(id),
        };
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
