import type { ObjectId } from "mongodb";

/**
 * One lever's branch-tree state. `starter` is the tier-1 unlock that gates the
 * three branch sub-tracks; `a`/`b`/`c` are the branch levels (0..maxBranchLevel
 * from OPS_TREES). Branch semantics per lever live in `upgradeCosts.ts`.
 */
export interface CampaignOpsTree {
  starter: boolean;
  a: number;
  b: number;
  c: number;
}

export interface CampaignFogOfWar {
  fundraisingLevel: number;
  oppositionResearchLevel: number;
  groundGameLevel: number;
  mediaSpendingLevel: number;
  lastUpdated: Date;
}

export interface CampaignActivity {
  type: "upgrade" | "downgrade" | "suspend_endorse";
  category?: "fundraising" | "oppositionResearch" | "groundGame" | "mediaSpending";
  /** Strategic Operations v2: which branch sub-track this entry concerns. */
  branch?: "a" | "b" | "c";
  newLevel?: number;
  costFunds?: number;
  costActions?: number;
  targetName?: string;
  /**
   * Only set on `downgrade` entries. `insolvency` = turn processor auto-demoted
   * because the campaign couldn't afford maintenance. `migration` = one-shot
   * backfill for campaigns that went negative before the auto-downgrade fix
   * landed. `reset` = manager/nominee/admin self-serve reset (currently only
   * Opposition Research has a reset endpoint).
   */
  reason?: "insolvency" | "migration" | "reset";
  timestamp: Date;
  turnNumber: number;
}

export interface CampaignDonation {
  donorId: string;
  donorName: string;
  donorType: "character" | "party";
  amount: number;
  timestamp: Date;
  turnNumber: number;
}

export interface Campaign {
  _id: ObjectId;
  electionId: ObjectId;
  candidateId: ObjectId;
  candidateIsNPP: boolean;
  party: string;

  /**
   * Lifecycle state. `"archived"` campaigns are retained but excluded from
   * active surfaces (primary loser, voluntary withdrawal, admin removal, ban).
   * Missing/undefined is treated as `"active"` for legacy rows. Campaigns are
   * only hard-deleted when the election resolves (see presidentResolution /
   * generalResolution) so the next cycle starts fresh.
   */
  status?: "active" | "archived";
  archivedAt?: Date | null;
  archivedReason?: "primary_loss" | "withdrawn" | "removed" | "banned";

  /**
   * Legacy single-manager pair. Retained and kept in sync with `managers[0]` so
   * pre-multi-manager readers keep working with no backfill. Prefer
   * `campaignManagerUserIds()` / `isCampaignManagerUser()` over reading these
   * directly — they fold both shapes together.
   */
  managerId: ObjectId | null;
  managerCharacterId: ObjectId | null;

  /**
   * Campaign managers, up to `MAX_CAMPAIGN_MANAGERS`. Absent on rows written
   * before the change; treat missing as "whatever `managerId` says".
   */
  managers?: Array<{
    userId: ObjectId;
    characterId: ObjectId;
    appointedAt: Date;
  }>;

  funds: number;
  actions: number;

  /**
   * Legacy linear investment levels (0..N). Retained as the migration source
   * of record and for back-compat reads on rows not yet converted to the
   * branch-tree model. New purchases write the `*Tree` fields below; the
   * one-shot migration (`migrateCampaignOpsTrees`) maps these into a starter
   * flag + branch levels. Do NOT add new consumers of these — read the tree.
   */
  fundraisingLevel: number;
  oppositionResearchLevel: number;
  groundGameLevel: number;
  mediaSpendingLevel: number;

  /**
   * Branch-tree investment (Strategic Operations v2). Each lever is a starter
   * unlock (tier 1) plus three independently-levelled branch sub-tracks
   * (a/b/c, each 0..maxBranchLevel). The per-branch meaning (what a/b/c do) is
   * defined in `upgradeCosts.ts` OPS_TREES. Optional/undefined on legacy rows
   * until the migration backfills them; effect code degrades to 0 / false.
   */
  fundraisingTree?: CampaignOpsTree;
  oppositionResearchTree?: CampaignOpsTree;
  groundGameTree?: CampaignOpsTree;
  mediaSpendingTree?: CampaignOpsTree;

  oppositionTargetId: ObjectId | null;
  oppositionTargetName: string | null;

  oppositionResearchCooldownUntil: Date | null;
  /**
   * Turn-based mirror of `oppositionResearchCooldownUntil`. The retarget guard
   * resolves against this so the cooldown freezes on pause and doesn't drift
   * with the game clock; the Date is kept for display + legacy fallback.
   */
  oppositionResearchCooldownUntilTurn?: number | null;
  donationLog: CampaignDonation[];

  publicFogOfWar: CampaignFogOfWar;
  partyFogOfWar: CampaignFogOfWar;

  activityHistory: CampaignActivity[];

  totalFundsGenerated: number;
  totalFundsSpent: number;
  totalActionsGenerated: number;
  totalActionsSpent: number;

  /**
   * Per-turn spend total — resets to 0 at the start of each turn-phase
   * sweep, then $inc'd by every spend write path (upgrade purchases via
   * `campaignCommands.ts`, maintenance ticks via `campaignTurn.ts`). Read
   * by the swing-flow engine's money driver to detect "active pacing" vs
   * "balance sitting idle" — see
   * `2026-05-22-swing-flow-driver-activation.md` §A2. Undefined / missing
   * on pre-Phase-A2 rows; degrades to 0 in the money-driver aggregation.
   */
  spendThisTurn?: number;

  /**
   * Optional candidate-set campaign color (hex like "#3B82F6"). Used to shade
   * the candidate on the per-party primary map and per-state primary pages, so
   * two candidates in the same party are visibly distinct. Nominee/manager/admin
   * may change it via POST /api/campaigns/[id]/color.
   */
  color?: string | null;

  /** Accumulated campaign strength from player contributions. Resets to 0 on election resolution. */
  campaignStrength?: number;

  createdAt: Date;
  updatedAt: Date;
}
