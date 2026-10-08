/**
 * Media corporations a buyer can pick from when proposing coverage
 * advertising. Only corporations with a human CEO who can answer a proposal
 * are listed, so a buyer never sends an offer nobody can accept.
 */
import type { Db } from "mongodb";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { getMediaOperatingModel } from "@/lib/mediaOperatingModels/catalog";
import {
  loadFxRatesByCurrency,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import type { Corporation } from "@/lib/db/types";

export interface AdvertisingSupplierOption {
  id: string;
  name: string;
  ticker?: string;
  mediaSectorCount: number;
  stateCount: number;
  models: string[];
  /** Public editorial position, when the publisher has set one. */
  editorialStance?: { economic: number; social: number };
}

export interface AdvertisingSupplierList {
  /** The buyer's marketing budget per turn in anchor currency, for previews. */
  buyerMarketingPerTurnAnchor: number;
  liquidCurrencyCode: string | null;
  suppliers: AdvertisingSupplierOption[];
}

export async function listAdvertisingSuppliers(
  db: Db,
  buyer: Corporation
): Promise<AdvertisingSupplierList> {
  const groups = await db
    .collection("corporateSectors")
    .aggregate<{
      _id: unknown;
      sectors: number;
      states: string[];
      strategies: string[];
    }>([
      { $match: { sectorType: "media", corporationId: { $ne: buyer._id } } },
      {
        $group: {
          _id: "$corporationId",
          sectors: { $sum: 1 },
          states: { $addToSet: "$stateId" },
          strategies: { $addToSet: "$strategyId" },
        },
      },
    ])
    .toArray();
  const ids = groups.map((group) => group._id);
  const corps = ids.length
    ? await db
        .collection<Corporation>("corporations")
        .find({
          _id: { $in: ids as never[] },
          ceoVacant: { $ne: true },
          ceoType: { $ne: "npp" },
          userId: { $exists: true },
        })
        .project<Pick<Corporation, "_id" | "name" | "ticker" | "editorialStance">>({
          name: 1,
          ticker: 1,
          editorialStance: 1,
        })
        .toArray()
    : [];
  const corpById = new Map(corps.map((corp) => [corp._id.toString(), corp]));
  const suppliers: AdvertisingSupplierOption[] = [];
  for (const group of groups) {
    const corp = corpById.get(String(group._id));
    if (!corp) continue;
    const models = [
      ...new Set(
        group.strategies.flatMap((strategyId) => {
          const model = getMediaOperatingModel(strategyId ?? "");
          return model ? [model.name] : [];
        })
      ),
    ];
    if (models.length === 0) continue;
    suppliers.push({
      id: corp._id.toString(),
      name: corp.name,
      ...(corp.ticker ? { ticker: corp.ticker } : {}),
      mediaSectorCount: group.sectors,
      stateCount: group.states.length,
      models,
      ...(corp.editorialStance ? { editorialStance: corp.editorialStance } : {}),
    });
  }
  suppliers.sort(
    (a, b) =>
      b.stateCount - a.stateCount ||
      b.mediaSectorCount - a.mediaSectorCount ||
      a.name.localeCompare(b.name)
  );

  const fx = await loadFxRatesByCurrency(db);
  const code = resolveCorpLiquidCurrencyCode(buyer);
  const perDay =
    code && typeof buyer.marketingBudget === "number" && buyer.marketingBudget > 0
      ? readCorpEconomicAnchor(buyer.marketingBudget, code, fxRateForCorpFromMap(buyer, fx))
      : 0;
  return {
    buyerMarketingPerTurnAnchor: perDay / TURNS_PER_DAY,
    liquidCurrencyCode: buyer.liquidCurrencyCode ?? null,
    suppliers: suppliers.slice(0, 60),
  };
}
