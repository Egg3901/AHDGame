/**
 * Pure read helpers over a corporation's tech tree (v2 — branching lanes).
 *
 * Never touches the DB — callers pass a minimal corp view. The same helpers back
 * the turn engine (effects), the unlock/abandon commands (validation), and the
 * UI (rendering), so the rules live in exactly one place.
 *
 * Lane model: each decade forks into a Corporate (`generic`) and a Sector lane.
 * The corp commits to ONE lane per decade (first unlock commits, tracked in
 * `techDecadeLane`); the other lane is locked until the decade is Abandoned.
 */

import type { CorporationType } from "../corporations";
import { TECH_TREE, type TechLane, type TechTreeNode } from "./nodes";
import {
  aggregateTechEffects,
  collectUnlockedStrategyIds,
  scaleEffect,
  CORP_LANE_EFFECT_SCALE,
  type AggregatedTechEffects,
  type TechEffect,
} from "./effects";
import {
  TECH_DECADES,
  getDecadeById,
  getDecadeForYear,
  getResearchableDecades,
  isDecadeReached,
} from "./decades";

/** Minimal corp shape the selectors need. */
export interface TechCorpView {
  type: CorporationType;
  unlockedTechNodeIds?: string[];
  /** Committed lane per decade id; absent decade ⇒ uncommitted. */
  techDecadeLane?: Record<string, TechLane>;
}

/** All nodes in a sector's tree. */
export function getTreeForType(sectorType: CorporationType): TechTreeNode[] {
  return TECH_TREE[sectorType] ?? [];
}

/** Find a node by id within a sector's tree (undefined if not part of it). */
export function getNodeById(sectorType: CorporationType, nodeId: string): TechTreeNode | undefined {
  return getTreeForType(sectorType).find((n) => n.id === nodeId);
}

/** Nodes in a sector's tree for a given decade + lane (UI columns). */
export function getDecadeLaneNodes(
  sectorType: CorporationType,
  decadeId: string,
  lane: TechLane
): TechTreeNode[] {
  return getTreeForType(sectorType).filter((n) => n.decadeId === decadeId && n.lane === lane);
}

/** Nodes the corp has actually unlocked that still belong to its current tree. */
export function getUnlockedNodes(corp: TechCorpView): TechTreeNode[] {
  const ids = corp.unlockedTechNodeIds ?? [];
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  return getTreeForType(corp.type).filter((n) => idSet.has(n.id));
}

/** Flat list of effects from every unlocked node. */
export function getActiveTechEffects(corp: TechCorpView): TechEffect[] {
  return getUnlockedNodes(corp).flatMap((n) => n.effects);
}

/** Engine-ready aggregate of EVERY unlocked node, unscaled (display / summary). */
export function getAggregatedTechEffects(corp: TechCorpView): AggregatedTechEffects {
  return aggregateTechEffects(getActiveTechEffects(corp));
}

/**
 * Effects that actually apply to a sector of `sectorType`:
 *  - Corporate-lane nodes apply to every sector at CORP_LANE_EFFECT_SCALE strength;
 *  - Sector-lane nodes apply only to the corp's primary sector type, full strength.
 * This is the per-sector aggregate the turn engine uses.
 */
export function getSectorTechEffects(
  corp: TechCorpView,
  sectorType: CorporationType
): AggregatedTechEffects {
  const isPrimary = sectorType === corp.type;
  const effects = getUnlockedNodes(corp).flatMap((node) => {
    if (node.lane === "generic")
      return node.effects.map((e) => scaleEffect(e, CORP_LANE_EFFECT_SCALE));
    return isPrimary ? node.effects : [];
  });
  return aggregateTechEffects(effects);
}

/** Production-method (strategy) ids the corp has unlocked via the tree. */
export function getUnlockedStrategyIds(corp: TechCorpView): string[] {
  return collectUnlockedStrategyIds(getActiveTechEffects(corp));
}

/**
 * Lane the corp has committed to for a decade. Prefers the explicit
 * `techDecadeLane` map; falls back to inferring from any unlocked node in that
 * decade (so legacy/partial data still reads correctly).
 */
export function getCommittedLane(corp: TechCorpView, decadeId: string): TechLane | undefined {
  const explicit = corp.techDecadeLane?.[decadeId];
  if (explicit) return explicit;
  return getUnlockedNodes(corp).find((n) => n.decadeId === decadeId)?.lane;
}

export type UnlockBlockReason =
  | "unknown-node"
  | "decade-locked"
  | "lane-locked"
  | "prereq-missing"
  | "already-owned"
  | "insufficient-rd"
  | "insufficient-cash";

/**
 * Fixed per-lane binary topology over a decade's 9 slots — two sub-paths of
 * four, hanging off the lane root:
 *
 *            slot 1  (lane root — committing unlock)
 *           /      \
 *        slot 2   slot 3
 *          |        |
 *        slot 4   slot 5
 *          |        |
 *        slot 6   slot 7
 *          |        |
 *        slot 8   slot 9
 *
 * A node can only be unlocked after its parent slot is owned, so each lane is
 * researched in tree order. Slot 1 has no parent (it commits the lane).
 */
export const SLOT_PARENT: Record<number, number | null> = {
  1: null,
  2: 1,
  3: 1,
  4: 2,
  5: 3,
  6: 4,
  7: 5,
  8: 6,
  9: 7,
};

/** Child slots for a given slot (UI tree layout). */
export const SLOT_CHILDREN: Record<number, number[]> = {
  1: [2, 3],
  2: [4],
  3: [5],
  4: [6],
  5: [7],
  6: [8],
  7: [9],
  8: [],
  9: [],
};

/** Node id of a node's prerequisite (same decade + lane, parent slot), or null. */
export function getNodePrereqId(node: TechTreeNode): string | null {
  const parentSlot = SLOT_PARENT[node.slot] ?? null;
  if (parentSlot == null) return null;
  return node.id.replace(/-\d+$/, `-${parentSlot}`);
}

export type CanUnlockResult =
  { ok: true; node: TechTreeNode } | { ok: false; reason: UnlockBlockReason; node?: TechTreeNode };

export interface CanUnlockFunds {
  rdScore: number;
  /** Cash the corp can spend (corp local currency / anchor — caller's choice, must match cashCost). */
  cashAvailable: number;
  /** Cash this unlock costs (derived from revenue × fraction by the caller). */
  cashCost: number;
}

/**
 * Whether `corp` may unlock `nodeId` at `currentYear` with the given funds.
 * Encodes every rule: node belongs to the tree, decade reached, lane matches the
 * decade's committed lane (or the decade is uncommitted), not already owned, and
 * both rdScore and cash are affordable.
 */
export function canUnlock(
  corp: TechCorpView,
  nodeId: string,
  currentYear: number,
  funds: CanUnlockFunds
): CanUnlockResult {
  const node = getNodeById(corp.type, nodeId);
  if (!node) return { ok: false, reason: "unknown-node" };
  if (!isDecadeReached(node.decadeId, currentYear)) {
    return { ok: false, reason: "decade-locked", node };
  }
  if ((corp.unlockedTechNodeIds ?? []).includes(nodeId)) {
    return { ok: false, reason: "already-owned", node };
  }
  const committed = getCommittedLane(corp, node.decadeId);
  if (committed && committed !== node.lane) {
    return { ok: false, reason: "lane-locked", node };
  }
  // Tree order: the parent node in this lane must be owned first.
  const prereqId = getNodePrereqId(node);
  if (prereqId && !(corp.unlockedTechNodeIds ?? []).includes(prereqId)) {
    return { ok: false, reason: "prereq-missing", node };
  }
  if (funds.rdScore < node.cost) {
    return { ok: false, reason: "insufficient-rd", node };
  }
  if (funds.cashAvailable < funds.cashCost) {
    return { ok: false, reason: "insufficient-cash", node };
  }
  return { ok: true, node };
}

/**
 * All node ids (generic + sector) for every decade strictly before the world's
 * current decade — auto-granted free at founding so late-era corps start with
 * both the shared corporate tech and the sector-specific unlocks of bygone decades.
 * Sector unlocks in past decades make strategies that were available before the
 * tech tree was introduced remain accessible without requiring research.
 */
export function autoGrantedNodeIds(corpType: CorporationType, currentYear: number): string[] {
  const researchable = new Set(getResearchableDecades(currentYear).map((d) => d.id));
  const ids: string[] = [];
  for (const node of getTreeForType(corpType)) {
    if (!researchable.has(node.decadeId)) ids.push(node.id);
  }
  return ids;
}

/** @deprecated Use autoGrantedNodeIds — sector lane is now included. */
export function autoGrantedCorporateNodeIds(currentYear: number): string[] {
  const researchable = new Set(getResearchableDecades(currentYear).map((d) => d.id));
  const ids: string[] = [];
  const firstType = Object.keys(TECH_TREE)[0] as CorporationType;
  for (const node of getTreeForType(firstType)) {
    if (node.lane === "generic" && !researchable.has(node.decadeId)) ids.push(node.id);
  }
  return ids;
}

/** Decades that are auto-granted (passed) vs researchable for a world. */
export function getPassedDecadeIds(currentYear: number): string[] {
  const researchable = new Set(getResearchableDecades(currentYear).map((d) => d.id));
  return TECH_DECADES.filter((d) => !researchable.has(d.id)).map((d) => d.id);
}

/** Human-readable label for a decade id (falls back to the raw id). */
export function decadeLabel(decadeId: string): string {
  return getDecadeById(decadeId)?.label ?? decadeId;
}

/**
 * Variant of getSectorTechEffects that limits per-turn stat bonuses to
 * the current and previous decade only. Strategy unlocks (unlockStrategy
 * effects) are ignored here — they're tracked separately via
 * getUnlockedStrategyIds and are permanent.
 */
export function getSectorTechEffectsForYear(
  corp: TechCorpView,
  sectorType: CorporationType,
  currentYear: number
): AggregatedTechEffects {
  const currentDecade = getDecadeForYear(currentYear);
  const currentIdx = TECH_DECADES.findIndex((d) => d.id === currentDecade.id);
  const prevDecade = currentIdx > 0 ? TECH_DECADES[currentIdx - 1] : null;
  const allowedIds = new Set([currentDecade.id, ...(prevDecade ? [prevDecade.id] : [])]);

  const isPrimary = sectorType === corp.type;
  const effects = getUnlockedNodes(corp).flatMap((node) => {
    if (!allowedIds.has(node.decadeId)) return [];
    if (node.lane === "generic")
      return node.effects.map((e) => scaleEffect(e, CORP_LANE_EFFECT_SCALE));
    return isPrimary ? node.effects : [];
  });
  return aggregateTechEffects(effects);
}
