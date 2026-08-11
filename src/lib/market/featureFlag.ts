import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

import { MARKET_MODE_ORDER, type MarketSystemMode } from "@/lib/market/modes";

/**
 * Structural market rework rollout mode ("Nothing Wants to Sell", audit t806).
 * Graduated and ordered — each tier is a superset of the previous one. See
 * docs/plans/2026-07-03-market-structural-plan.md. The mode enum/order/TLDRs
 * live in the client-safe `modes.ts`; this module adds the server-side
 * resolution (Mongo) and comparisons.
 */
export { MARKET_MODE_ORDER, type MarketSystemMode } from "@/lib/market/modes";

export function isMarketSystemMode(value: unknown): value is MarketSystemMode {
  return typeof value === "string" && (MARKET_MODE_ORDER as readonly string[]).includes(value);
}

/** Numeric rank of a mode (off=0 … plants=5). */
export function marketModeRank(mode: MarketSystemMode): number {
  return MARKET_MODE_ORDER.indexOf(mode);
}

/** True when `mode` is at least the given `tier` (inclusive). */
export function marketAtLeast(mode: MarketSystemMode, tier: MarketSystemMode): boolean {
  return marketModeRank(mode) >= marketModeRank(tier);
}

/**
 * Resolve the current market-system mode.
 * Pass a preloaded config from the same request to avoid an extra read.
 * Returns "off" for absent/unknown values.
 */
export async function getMarketSystemMode(
  preloadedConfig?: Pick<GameConfig, "marketSystemMode"> | null
): Promise<MarketSystemMode> {
  let mode: unknown;
  if (preloadedConfig !== undefined) {
    mode = preloadedConfig?.marketSystemMode;
  } else {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { marketSystemMode: 1 } });
    mode = config?.marketSystemMode;
  }
  return isMarketSystemMode(mode) ? mode : "off";
}

/**
 * Resolve the mode from an EXPLICIT Db handle.
 *
 * {@link getMarketSystemMode} opens its own connection via `getDb()`, which is
 * wrong for any routine that was handed a `db` (a turn phase, a command, a test
 * running against a mock): it either hits the wrong database or, in tests, has
 * no connection string at all. Use this wherever a `db` is already in scope.
 * Returns "off" for an absent/unknown value, so a mock without a `gameConfig`
 * collection resolves to legacy behaviour rather than throwing.
 */
export async function getMarketSystemModeForDb(db: Db): Promise<MarketSystemMode> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { marketSystemMode: 1 } });
  return isMarketSystemMode(config?.marketSystemMode) ? config.marketSystemMode : "off";
}

/** Fix 1: realized sector revenue scaled by lagged output prices (mode ≥ "realization"). */
export async function isMarketRealizationEnabled(
  preloadedConfig?: Pick<GameConfig, "marketSystemMode"> | null
): Promise<boolean> {
  return marketAtLeast(await getMarketSystemMode(preloadedConfig), "realization");
}

/**
 * Structural extraction-shortage stabilizer (audit t873). Independent of the
 * marketSystemMode ladder — a standalone boolean so it can be dialed in on its
 * own (e.g. enabled in a sandbox sim to validate before touching prod).
 * Pass a preloaded config to avoid an extra read.
 */
export async function getExtractionOutputScaleEnabled(
  preloadedConfig?: Pick<GameConfig, "extractionOutputScaleEnabled"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) return preloadedConfig?.extractionOutputScaleEnabled === true;
  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { extractionOutputScaleEnabled: 1 } });
  return config?.extractionOutputScaleEnabled === true;
}

/**
 * Demographics-as-4th-demand-source flag (default off; uncalibrated). Routed
 * through this helper (not a direct findOne) so tests can mock it without a
 * gameConfig.findOne on their shared mock db.
 */
export async function getDemographicsDemandEnabled(
  preloadedConfig?: Pick<GameConfig, "demographicsDemandEnabled"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) return preloadedConfig?.demographicsDemandEnabled === true;
  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { demographicsDemandEnabled: 1 } });
  return config?.demographicsDemandEnabled === true;
}

/**
 * Household Ledger — income-driven consumer demand flag (default off;
 * uncalibrated). Routed through this helper (not a direct findOne) so tests can
 * mock it without a gameConfig.findOne on their shared mock db. When on, the
 * household consumption pass runs and the retail-revenue consumer proxy is
 * suppressed — see `householdConsumptionEnabled` in gameConfig and
 * `src/lib/turn/householdConsumption.ts`.
 */
export async function getHouseholdConsumptionEnabled(
  preloadedConfig?: Pick<GameConfig, "householdConsumptionEnabled"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) return preloadedConfig?.householdConsumptionEnabled === true;
  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { householdConsumptionEnabled: 1 } });
  return config?.householdConsumptionEnabled === true;
}
