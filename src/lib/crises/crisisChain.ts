import type { Db } from "mongodb";
import type { Crisis, CrisisTemplate } from "@/lib/db/types/crisis";
import { ALL_CRISIS_TEMPLATES } from "./templates";
import { createCrisisFromTemplate } from "./createCrisisFromTemplate";
import { isTemplateAllowedInYear } from "./crisisEraWindow";
import { announceVietnamChainStart } from "./vietnamWire";
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

/** Template keys of the two launch-decision crises, one per superpower. */
export const VIETNAM_COMMITMENT_TEMPLATE_KEYS = [
  "vietnam_us_commitment",
  "vietnam_ussr_commitment",
] as const;

export interface OpenVietnamChainResult {
  started: boolean;
  /** Why it did not start, when it did not. */
  reason?: "outside_era_window" | "already_started";
  /** New crisis ids: the opening rung plus the two commitment decisions. */
  crisisIds: string[];
  level: number;
}

/**
 * Start the Vietnam chain.
 *
 * One entry point for both callers. The turn loop calls it every turn and it
 * no-ops until the world reaches the era window; the admin console calls it to
 * start the war on demand. It is idempotent in both directions:
 * `openVietnamEscalation` returns null once the family has opened, so a second
 * call cannot produce a second war, and a chain that has been talked down to
 * nothing stays down rather than restarting.
 *
 * Starting it does three things. The opening rung spawns, so the ladder has its
 * crisis. Both superpowers get their own commitment decision, each with a 24
 * hour window. And the press covers it, globally and in both capitals.
 *
 * The era window is enforced for the admin path too. These templates are dated
 * 1955 to 1975 and a Vietnam war in a 2008 world would be nonsense, so the
 * button reports the refusal rather than quietly producing one.
 */
export async function openVietnamChain(
  db: Db,
  currentTurn: number,
  currentYear: number | null | undefined
): Promise<OpenVietnamChainResult> {
  if (
    typeof currentYear !== "number" ||
    currentYear < VIETNAM_FROM_YEAR ||
    currentYear > VIETNAM_UNTIL_YEAR
  ) {
    return { started: false, reason: "outside_era_window", crisisIds: [], level: 0 };
  }

  const opened = await openVietnamEscalation(db);
  if (!opened) {
    const level = await getVietnamEscalationLevel(db);
    return { started: false, reason: "already_started", crisisIds: [], level };
  }

  const crisisIds: string[] = [];
  const spawn = async (key: string): Promise<void> => {
    const template = ALL_CRISIS_TEMPLATES[key] as CrisisTemplate | undefined;
    if (!template || !isTemplateAllowedInYear(template, currentYear)) return;
    const id = await createCrisisFromTemplate(db, {
      template,
      templateKey: key,
      scope: template.scope,
      countryIds: template.countryIds,
      regionIds: template.regionIds,
      currentTurn,
      autoSource: "condition",
    });
    crisisIds.push(id.toString());
    // A crisis created outside the turn loop's `turn === startTurn` branch is
    // never announced by it, so announce here. Dynamically imported: the turn
    // module imports this one, and a static import back would close the cycle.
    const { announceCrisisStart } = await import("@/lib/turn/crisisTurn");
    const crisis = await db.collection<Crisis>("crises").findOne({ _id: id });
    if (crisis) await announceCrisisStart(db, crisis);
  };

  const rungKey = vietnamTemplateKeyForLevel(opened.level);
  if (rungKey && !(await familyIsActive(db, "vietnam"))) {
    await spawn(rungKey);
  }
  for (const key of VIETNAM_COMMITMENT_TEMPLATE_KEYS) {
    await spawn(key);
  }

  await announceVietnamChainStart(opened.level);

  return { started: true, crisisIds, level: opened.level };
}

/**
 * Open the Vietnam family once the world reaches its era window.
 *
 * Called every turn. Delegates to `openVietnamChain`, which owns the whole
 * start: the opening rung, both commitment decisions and the press coverage.
 * The generic auto-spawner cannot do any of this. It rewrites `countryIds` to a
 * single nation, a Vietnam rung is addressed to BOTH superpowers at once, and it
 * has no notion of a family that must open exactly once.
 */
export async function processVietnamChainOpening(
  db: Db,
  currentTurn: number,
  currentYear: number | null | undefined
): Promise<{ spawned: number }> {
  const result = await openVietnamChain(db, currentTurn, currentYear);
  return { spawned: result.crisisIds.length };
}
