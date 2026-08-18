import type { Db } from "mongodb";
import type { MigrationResult } from "../../src/lib/migrations/types";

/**
 * Strategic Operations v2 — convert legacy linear investment levels into the
 * branch-tree model so no active campaign loses its purchased investment.
 *
 * Mapping (player-friendly, never removes a purchased step): a lever with legacy
 * level L >= 1 gets its starter unlocked, and the remaining (L - 1) steps are
 * poured into its branches in order a → b → c, each capped at 3. Because branch
 * `a` is every lever's primary effect channel (Grassroots income, Field Offices
 * swing, Broadcast favorability, Dossier drain), filling it first preserves the
 * dominant effect the player was already getting.
 *
 * NOTE: v2 rebalances raw magnitudes (e.g. maxed fundraising income is lower
 * than the old L10 $5M/turn), so this preserves INVESTMENT DEPTH, not the exact
 * per-turn number. That is the intended, worldsim-validated rebalance.
 *
 * Idempotent: only campaigns whose lever tree is not yet started are touched;
 * a second pass finds nothing to convert.
 */

const MAX_BRANCH = 3;

type LegacyKey =
  "fundraisingLevel" | "oppositionResearchLevel" | "groundGameLevel" | "mediaSpendingLevel";

const LEVERS: Array<{ legacy: LegacyKey; tree: string }> = [
  { legacy: "fundraisingLevel", tree: "fundraisingTree" },
  { legacy: "oppositionResearchLevel", tree: "oppositionResearchTree" },
  { legacy: "groundGameLevel", tree: "groundGameTree" },
  { legacy: "mediaSpendingLevel", tree: "mediaSpendingTree" },
];

/** Distribute (level-1) steps across a→b→c, each capped at MAX_BRANCH. */
export function levelToTree(level: number): { starter: boolean; a: number; b: number; c: number } {
  if (!Number.isFinite(level) || level <= 0) {
    return { starter: false, a: 0, b: 0, c: 0 };
  }
  let remaining = Math.floor(level) - 1;
  const take = () => {
    const n = Math.min(MAX_BRANCH, remaining);
    remaining -= n;
    return n;
  };
  return { starter: true, a: take(), b: take(), c: take() };
}

export async function runCampaignOpsTrees(
  db: Db,
  opts: { dryRun?: boolean } = {}
): Promise<MigrationResult> {
  const dryRun = !!opts.dryRun;
  const campaigns = db.collection("campaigns");
  const notes: string[] = [];

  // Candidates: any campaign with at least one un-started lever tree AND a
  // positive legacy level on that lever. Fetch broadly, decide per-lever.
  const cursor = campaigns.find(
    {},
    {
      projection: {
        _id: 1,
        fundraisingLevel: 1,
        oppositionResearchLevel: 1,
        groundGameLevel: 1,
        mediaSpendingLevel: 1,
        fundraisingTree: 1,
        oppositionResearchTree: 1,
        groundGameTree: 1,
        mediaSpendingTree: 1,
      },
    }
  );

  let scanned = 0;
  let updated = 0;

  for await (const c of cursor) {
    scanned++;
    const set: Record<string, unknown> = {};
    for (const { legacy, tree } of LEVERS) {
      const existing = c[tree] as { starter?: boolean } | undefined;
      if (existing?.starter) continue; // already migrated / bought in v2
      const level = (c[legacy] as number) ?? 0;
      if (level <= 0) {
        // Initialize an explicit empty tree so effect code has a stable shape.
        if (!existing) set[tree] = { starter: false, a: 0, b: 0, c: 0 };
        continue;
      }
      set[tree] = levelToTree(level);
    }
    if (Object.keys(set).length === 0) continue;
    updated++;
    if (!dryRun) {
      await campaigns.updateOne({ _id: c._id }, { $set: set });
    }
  }

  notes.push(
    `${dryRun ? "[dry-run] " : ""}Converted ${updated} of ${scanned} campaigns to ops branch trees.`
  );
  return { documentsScanned: scanned, documentsUpdated: updated, notes };
}
