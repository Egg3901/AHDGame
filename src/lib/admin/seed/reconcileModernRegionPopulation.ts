import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import { apportionRegionPopulation } from "./rules/apportionRegionPopulation";

const LEGACY_REGION_COUNTRIES = [
  "IE",
  "CN",
  "NG",
  "FR",
  "IT",
  "ES",
  "SE",
  "GR",
  "AT",
  "FI",
] as const;

/**
 * 2027 diagnostic overlay: scale legacy region shares to each fiscal population.
 * Relative region weights are proxies until individually sourced modern bundles
 * replace them. The national anchors are the existing budget seed values.
 */
export async function reconcileModernRegionPopulation(
  db: Db,
  preset: string,
  log: (message: string) => void
) {
  if (preset !== "2027-default") return;
  const budgets = new Map(
    getNationalBudgetSeedConfigsForPreset(preset).map((config) => [
      config.countryId,
      config.population,
    ])
  );
  for (const countryId of LEGACY_REGION_COUNTRIES) {
    const target = budgets.get(countryId);
    if (target == null) continue;
    const regions = await db
      .collection<State>("states")
      .find({ countryId }, { projection: { _id: 1, population: 1 } })
      .toArray();
    if (regions.length === 0) continue;
    const before = regions.reduce((sum, region) => sum + (region.population ?? 0), 0);
    if (before === target) continue;
    const apportioned = apportionRegionPopulation(
      regions.map((region) => ({ id: region._id, population: region.population ?? 0 })),
      target
    );
    await db.collection<State>("states").bulkWrite(
      apportioned.map((region) => ({
        updateOne: {
          filter: { _id: region.id },
          update: { $set: { population: region.population } },
        },
      }))
    );
    log(`[${countryId}] 2027 regional population overlay: ${before} -> ${target}`);
  }
}
