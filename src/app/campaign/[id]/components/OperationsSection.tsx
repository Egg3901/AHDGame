"use client";

import { useState } from "react";
import { Tooltip } from "@/components/Tooltip";
import {
  CAMPAIGN_CATEGORIES,
  getCampaignCategoriesForElection,
  type CampaignData,
} from "@/lib/campaigns/dto/campaignView";
import type { UpgradeCategory } from "@/lib/campaigns/upgradeCosts";
import { LevelBar } from "./LevelBar";
import { OperationsModal } from "./OperationsModal";

interface OperationsSectionProps {
  campaign: CampaignData;
  isOwner: boolean;
  upgrading: string | null;
  onUpgrade: (category: string, branch?: "a" | "b" | "c" | null, targetId?: string) => void;
  onRetarget?: (targetId: string) => void;
  onResetOppositionResearch?: () => void;
  resettingOppositionResearch?: boolean;
}

/**
 * Strategic Operations v2. Owner view is a row of one button per lever; clicking
 * a button opens that lever's tree modal (starter + three branch sub-tracks).
 * Non-owner (fog) view is a compact read-only investment summary.
 */
export function OperationsSection({
  campaign,
  isOwner,
  upgrading,
  onUpgrade,
  onRetarget,
  onResetOppositionResearch,
  resettingOppositionResearch = false,
}: OperationsSectionProps) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  // Race-family-aware copy (swing states vs counties vs precincts) when we know
  // the election; otherwise presidential-default labels.
  const categories = campaign.electionInfo?.electionType
    ? getCampaignCategoriesForElection({ electionType: campaign.electionInfo.electionType })
    : CAMPAIGN_CATEGORIES;

  const opsTrees = campaign.opsTrees;

  // Non-owner fog view — read-only summary using the shared level snapshot.
  if (!isOwner || !opsTrees) {
    return (
      <div className="mb-6 rounded-xl border border-card-border bg-card p-5">
        <h2 className="mb-4 text-lg font-semibold">Campaign Operations</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {categories.map((cat) => {
            const level = campaign.levels[cat.key as keyof typeof campaign.levels];
            return (
              <div key={cat.key} className={`rounded-lg border p-4 ${cat.bgClass}`}>
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <h3 className={`text-sm font-semibold ${cat.colorClass}`}>{cat.label}</h3>
                    <p className="mt-0.5 text-xs text-muted">{cat.description}</p>
                  </div>
                  <span className={`font-mono text-lg font-bold ${cat.colorClass}`}>{level}</span>
                </div>
                <LevelBar level={level} max={10} barClass={cat.barClass} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const openCat = openCategory ? categories.find((c) => c.key === openCategory) : null;
  const openTree = openCategory ? opsTrees[openCategory as UpgradeCategory] : null;

  return (
    <div className="mb-6 rounded-xl border border-card-border bg-card p-5">
      <h2 className="mb-1 text-lg font-semibold">Strategic Operations</h2>
      <p className="mb-4 text-xs text-muted">
        Each lever is a starter unlock plus three branches. Tap a lever to invest.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {categories.map((cat) => {
          const tree = opsTrees[cat.key as UpgradeCategory];
          const invested = tree
            ? (tree.unlocked ? 1 : 0) + tree.branches.reduce((s, b) => s + b.level, 0)
            : 0;
          const maxInvest = 1 + tree.branches.length * (tree.branches[0]?.maxLevel ?? 3);
          return (
            <Tooltip key={cat.key} content={cat.tooltipText}>
              <button
                type="button"
                onClick={() => setOpenCategory(cat.key)}
                className={`flex w-full flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:brightness-110 ${cat.bgClass}`}
              >
                <span className={`text-sm font-semibold ${cat.colorClass}`}>{cat.label}</span>
                <span className="text-[11px] text-muted">
                  {tree.unlocked ? `${invested}/${maxInvest} invested` : "Locked — tap to unlock"}
                </span>
                <LevelBar level={invested} max={maxInvest} barClass={cat.barClass} />
              </button>
            </Tooltip>
          );
        })}
      </div>

      {openCat && openTree && (
        <OperationsModal
          campaign={campaign}
          category={openCat}
          tree={openTree}
          upgrading={upgrading}
          onUpgrade={onUpgrade}
          onRetarget={onRetarget}
          onResetOppositionResearch={
            openCat.key === "oppositionResearch" ? onResetOppositionResearch : undefined
          }
          resettingOppositionResearch={resettingOppositionResearch}
          onClose={() => setOpenCategory(null)}
        />
      )}
    </div>
  );
}
