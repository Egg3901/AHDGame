import type { Db } from "mongodb";
import type { Crisis, CrisisTemplate } from "@/lib/db/types/crisis";
import { ALL_CRISIS_TEMPLATES } from "./templates";
import { createCrisisFromTemplate } from "./createCrisisFromTemplate";
import { isTemplateAllowedInYear } from "./crisisEraWindow";
import {
  getVietnamEscalationLevel,
  openVietnamEscalation,
  VIETNAM_FROM_YEAR,
  VIETNAM_UNTIL_YEAR,
  vietnamTemplateKeyForLevel,
} from "./vietnamEscalation";

/**
 * Chained crisis families.
 *
 * A family is several templates that are rungs of one escalating event. When a
 * rung's crisis expires the chain asks the family where its underlying state now
 * sits and spawns the rung that matches, so a family can climb, hold, or climb
 * back down according to what players did, and a family whose state has fallen
 * to nothing simply stops.
 *
 * This is deliberately a general mechanism rather than Vietnam-specific plumbing.
 * A new family needs a `chain: { family, rung }` on each of its templates, a
 * level resolver here, and nothing else.
 */

/** Where a family's ladder currently sits. 0 (or null) ends the chain. */
export type ChainLevelResolver = (db: Db) => Promise<number>;

export const CHAIN_LEVEL_RESOLVERS: Record<string, ChainLevelResolver> = {
  vietnam: getVietnamEscalationLevel,
};

/** Templates in a family, keyed by rung. Pure. */
export function familyTemplates(family: string): Map<number, [string, CrisisTemplate]> {
  const byRung = new Map<number, [string, CrisisTemplate]>();
  for (const [key, template] of Object.entries(ALL_CRISIS_TEMPLATES) as [
    string,
    CrisisTemplate,
  ][]) {
    if (template.chain?.family === family) byRung.set(template.chain.rung, [key, template]);
  }
  return byRung;
}

/** The template key a family should advance to at `level`, or null to stop. Pure. */
export function chainTemplateKeyForLevel(family: string, level: number): string | null {
  if (!(level > 0)) return null;
  return familyTemplates(family).get(level)?.[0] ?? null;
}

/** True when a crisis of this family is already live (or already spawned this turn). */
async function familyIsActive(db: Db, family: string): Promise<boolean> {
  const live = await db
    .collection<Crisis>("crises")
    .findOne({ "chain.family": family, status: "active" });
  return live !== null;
}

/**
 * Spawn the next rung for every chained crisis that just expired.
 *
 * Called from the crisis turn immediately after the batch that marks crises
 * resolved, with those same crises. A family whose level has fallen to 0 gets no
 * successor, which is exactly how a de-escalated war ends.
 */
export async function processCrisisChain(
  db: Db,
  resolved: Crisis[],
  currentTurn: number
): Promise<{ spawned: number }> {
  let spawned = 0;
  const handled = new Set<string>();

  for (const crisis of resolved) {
    const family = crisis.chain?.family;
    if (!family || handled.has(family)) continue;
    handled.add(family);

    const resolver = CHAIN_LEVEL_RESOLVERS[family];
    if (!resolver) continue;

    const level = await resolver(db);
    const nextKey = chainTemplateKeyForLevel(family, level);
    if (!nextKey) continue;
    if (await familyIsActive(db, family)) continue;

    const template = ALL_CRISIS_TEMPLATES[nextKey] as CrisisTemplate;
    await createCrisisFromTemplate(db, {
      template,
      templateKey: nextKey,
      scope: template.scope,
      countryIds: template.countryIds,
      regionIds: template.regionIds,
      currentTurn,
      autoSource: "condition",
    });
    spawned++;
  }

  return { spawned };
}

/**
 * Open the Vietnam family once the world reaches its era window.
 *
 * The generic auto-spawner cannot do this: it rewrites `countryIds` to a single
 * nation, and a Vietnam rung is addressed to BOTH superpowers at once. It also
 * has no notion of a family that must open exactly once.
 */
export async function processVietnamChainOpening(
  db: Db,
  currentTurn: number,
  currentYear: number | null | undefined
): Promise<{ spawned: number }> {
  if (typeof currentYear !== "number") return { spawned: 0 };
  if (currentYear < VIETNAM_FROM_YEAR || currentYear > VIETNAM_UNTIL_YEAR) return { spawned: 0 };

  const opened = await openVietnamEscalation(db);
  if (!opened) return { spawned: 0 };

  const key = vietnamTemplateKeyForLevel(opened.level);
  if (!key) return { spawned: 0 };
  const template = ALL_CRISIS_TEMPLATES[key] as CrisisTemplate | undefined;
  if (!template || !isTemplateAllowedInYear(template, currentYear)) return { spawned: 0 };
  if (await familyIsActive(db, "vietnam")) return { spawned: 0 };

  await createCrisisFromTemplate(db, {
    template,
    templateKey: key,
    scope: template.scope,
    countryIds: template.countryIds,
    regionIds: template.regionIds,
    currentTurn,
    autoSource: "condition",
  });
  return { spawned: 1 };
}
