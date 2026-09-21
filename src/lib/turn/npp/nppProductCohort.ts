import type { Db } from "mongodb";
import { isCorporationProductsEnabled } from "@/lib/products/featureFlag";
import {
  CORPORATION_OPERATING_MODELS_COLLECTION,
  CORPORATION_PRODUCTS_COLLECTION,
  type CorporationOperatingModelDocument,
  type CorporationProductDocument,
} from "@/lib/products/persistence";
import type { CorporationProduct } from "@/lib/products/types";

export interface NppProductCohort {
  enabled: boolean;
  activeProductByCorp: Map<string, CorporationProduct>;
  operatingModelsByCorp: Map<string, string[]>;
}

/** Loads all product inputs for an NPP cohort without per-corporation reads. */
export async function loadNppProductCohort(
  db: Db,
  corporationIds: readonly string[]
): Promise<NppProductCohort> {
  const [enabled, productDocs, modelDocs] = await Promise.all([
    isCorporationProductsEnabled(db),
    db
      .collection<CorporationProductDocument>(CORPORATION_PRODUCTS_COLLECTION)
      .find(
        { activeCorporationId: { $in: corporationIds } },
        {
          projection: {
            corporationId: 1,
            kindId: 1,
            name: 1,
            stage: 1,
            startedTurn: 1,
            lastProcessedTurn: 1,
            launchedTurn: 1,
            retiredTurn: 1,
            developmentSpendAnchor: 1,
            developmentAdvertisingAnchor: 1,
            developmentAdvertisingTurns: 1,
            productBrand: 1,
            launchQuality: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<CorporationOperatingModelDocument>(CORPORATION_OPERATING_MODELS_COLLECTION)
      .find(
        { corporationId: { $in: corporationIds } },
        { projection: { corporationId: 1, operatingModel: 1 } }
      )
      .toArray(),
  ]);

  const activeProductByCorp = new Map<string, CorporationProduct>();
  for (const doc of productDocs) {
    if (activeProductByCorp.has(doc.corporationId)) continue;
    activeProductByCorp.set(doc.corporationId, {
      id: doc._id,
      corporationId: doc.corporationId,
      kindId: doc.kindId,
      name: doc.name,
      stage: doc.stage,
      startedTurn: doc.startedTurn,
      lastProcessedTurn: doc.lastProcessedTurn,
      launchedTurn: doc.launchedTurn,
      retiredTurn: doc.retiredTurn,
      developmentSpendAnchor: doc.developmentSpendAnchor,
      developmentAdvertisingAnchor: doc.developmentAdvertisingAnchor,
      developmentAdvertisingTurns: doc.developmentAdvertisingTurns,
      productBrand: doc.productBrand,
      launchQuality: doc.launchQuality,
    });
  }

  const operatingModelsByCorp = new Map<string, string[]>();
  for (const doc of modelDocs) {
    const list = operatingModelsByCorp.get(doc.corporationId) ?? [];
    list.push(doc.operatingModel);
    operatingModelsByCorp.set(doc.corporationId, list);
  }

  return { enabled, activeProductByCorp, operatingModelsByCorp };
}
