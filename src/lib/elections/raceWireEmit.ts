import { ObjectId, type Db } from "mongodb";
import { logWireEvent } from "@/lib/wireEvent";
import {
  wireHeadlineCampaignOpsLevel,
  wireHeadlineCampaignRally,
  wireHeadlinePrimaryTierLocked,
  wireHeadlineStateAttack,
} from "@/lib/campaignWireHeadlines";
import { CAMPAIGN_CATEGORIES } from "@/lib/campaigns/dto/campaignView";
import type { UpgradeCategory } from "@/lib/campaigns/upgradeCosts";
import type { PrimaryStateActionKind } from "@/lib/db/types";

/**
 * Emitters for the per-race wire.
 *
 * Every function here is fire-and-forget: callers invoke them with `void` and
 * they never throw, so a wire failure can never roll back the upgrade, rally or
 * tally that produced it. `logWireEvent` already swallows its own errors; the
 * try/catch here covers the name lookups these emitters do first.
 */

type CampaignLike = {
  _id: ObjectId;
  electionId: ObjectId;
  candidateId: ObjectId;
  fundraisingTree?: OpsTree;
  oppositionResearchTree?: OpsTree;
  groundGameTree?: OpsTree;
  mediaSpendingTree?: OpsTree;
};

interface OpsTree {
  starter: boolean;
  a: number;
  b: number;
  c: number;
}

const TREE_FIELD: Record<UpgradeCategory, keyof CampaignLike> = {
  fundraising: "fundraisingTree",
  oppositionResearch: "oppositionResearchTree",
  groundGame: "groundGameTree",
  mediaSpending: "mediaSpendingTree",
};

/** Total invested in a lever: the starter plus its three branch levels, 0..10. */
export function investedInLever(campaign: CampaignLike, category: UpgradeCategory): number {
  const tree = campaign[TREE_FIELD[category]] as OpsTree | undefined;
  if (!tree) return 0;
  return (tree.starter ? 1 : 0) + (tree.a ?? 0) + (tree.b ?? 0) + (tree.c ?? 0);
}

function leverLabel(category: UpgradeCategory): string {
  return CAMPAIGN_CATEGORIES.find((c) => c.key === category)?.label ?? category;
}

/**
 * Resolve a candidate's display name. Presidential fields mix player characters
 * and non-player politicians, so both collections are tried.
 */
async function candidateName(db: Db, candidateId: ObjectId): Promise<string | null> {
  const character = await db
    .collection<{ name?: string }>("characters")
    .findOne({ _id: candidateId }, { projection: { name: 1 } });
  if (character?.name) return character.name;

  const npp = await db
    .collection<{ name?: string }>("npps")
    .findOne({ _id: candidateId }, { projection: { name: 1 } });
  return npp?.name ?? null;
}

/** A campaign took one of its operation levers to a new level. */
export async function emitOpsLevelWire(
  db: Db,
  campaign: CampaignLike,
  category: UpgradeCategory
): Promise<void> {
  try {
    const name = await candidateName(db, campaign.candidateId);
    if (!name) return;
    await logWireEvent(
      "campaign_ops_level",
      wireHeadlineCampaignOpsLevel(name, leverLabel(category), investedInLever(campaign, category)),
      {
        electionId: campaign.electionId.toString(),
        campaignId: campaign._id.toString(),
        href: `/campaign/${campaign._id.toString()}`,
      }
    );
  } catch {
    // Fire-and-forget.
  }
}

/** A campaign fired a rally and banked Support. */
export async function emitRallyWire(
  db: Db,
  campaign: CampaignLike,
  supportGain: number
): Promise<void> {
  try {
    if (!(supportGain > 0)) return;
    const name = await candidateName(db, campaign.candidateId);
    if (!name) return;
    await logWireEvent("campaign_rally", wireHeadlineCampaignRally(name, supportGain), {
      electionId: campaign.electionId.toString(),
      campaignId: campaign._id.toString(),
      href: `/campaign/${campaign._id.toString()}`,
    });
  } catch {
    // Fire-and-forget.
  }
}

/** A primary delegate tier closed and awarded its delegates. */
export async function emitPrimaryTierWire(
  electionId: ObjectId | string,
  tier: number,
  delegates: number
): Promise<void> {
  try {
    if (!(delegates > 0)) return;
    await logWireEvent("primary_tier_locked", wireHeadlinePrimaryTierLocked(tier, delegates), {
      electionId: electionId.toString(),
      href: `/elections/${electionId.toString()}`,
    });
  } catch {
    // Fire-and-forget.
  }
}

// State calls are not emitted here on purpose. `liveResults/computeResults.ts`
// defines a called unit as a display projection, with the turn engine as the
// sole authority on outcomes, so persisting a call as an engine event would
// contradict that. The general-election ticker builds its call headlines with
// `wireHeadlineStateCalled` from the same projection at render time.

/**
 * A candidate opened a local attack on a rival in a state.
 *
 * Attacks are attributed deliberately: an act against another player that
 * nobody can trace reads as a bug rather than a mechanic.
 */
export async function emitStateAttackWire(
  electionId: ObjectId | string,
  kind: PrimaryStateActionKind,
  actorName: string,
  targetName: string,
  stateName: string
): Promise<void> {
  try {
    if (!actorName || !targetName) return;
    await logWireEvent(
      "campaign_state_attack",
      wireHeadlineStateAttack(kind, actorName, targetName, stateName),
      { electionId: electionId.toString() }
    );
  } catch {
    // Fire-and-forget.
  }
}
