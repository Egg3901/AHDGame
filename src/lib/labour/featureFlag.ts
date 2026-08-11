import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

/**
 * Labour/Unions system rollout mode. Graduated and ordered — each tier is a
 * superset of the previous one. See docs/plans/2026-06-30-labour-system.md.
 *
 * The enum, its order and the tier comparisons live in `@/lib/labour/modes`
 * (pure, no Mongo) and are re-exported here so existing importers are
 * unaffected. Mirrors the market/modes split.
 */
export {
  LABOUR_MODE_ORDER,
  isLabourSystemMode,
  labourModeRank,
  labourAtLeast,
  type LabourSystemMode,
} from "@/lib/labour/modes";

import {
  LABOUR_MODE_ORDER,
  isLabourSystemMode,
  labourAtLeast,
  type LabourSystemMode,
} from "@/lib/labour/modes";

/**
 * Resolve the current labour-system mode.
 * Pass a preloaded config from the same request to avoid an extra read.
 * Returns "off" for absent/unknown values.
 */
export async function getLabourSystemMode(
  preloadedConfig?: Pick<GameConfig, "labourSystemMode"> | null
): Promise<LabourSystemMode> {
  let mode: unknown;
  if (preloadedConfig !== undefined) {
    mode = preloadedConfig?.labourSystemMode;
  } else {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { labourSystemMode: 1 } });
    mode = config?.labourSystemMode;
  }
  return isLabourSystemMode(mode) ? mode : "off";
}

/** Explicit per-tier labor cost, wage slider, min-wage law, automation tech (mode ≥ "wages"). */
export async function isLabourWagesEnabled(
  preloadedConfig?: Pick<GameConfig, "labourSystemMode"> | null
): Promise<boolean> {
  return labourAtLeast(await getLabourSystemMode(preloadedConfig), "wages");
}

/** Wages ↔ unemployment ↔ politics macro loop (mode ≥ "macro"). */
export async function isLabourMacroEnabled(
  preloadedConfig?: Pick<GameConfig, "labourSystemMode"> | null
): Promise<boolean> {
  return labourAtLeast(await getLabourSystemMode(preloadedConfig), "macro");
}

/** NPC unionization + strikes (mode ≥ "unions"). Union-busting/union laws are gated at "full" — see `isLabourFullMode`. */
export async function isLabourUnionsEnabled(
  preloadedConfig?: Pick<GameConfig, "labourSystemMode"> | null
): Promise<boolean> {
  return labourAtLeast(await getLabourSystemMode(preloadedConfig), "unions");
}

/** Player-run unions (mode === "full"). */
export async function isLabourFullMode(
  preloadedConfig?: Pick<GameConfig, "labourSystemMode"> | null
): Promise<boolean> {
  return labourAtLeast(await getLabourSystemMode(preloadedConfig), "full");
}
