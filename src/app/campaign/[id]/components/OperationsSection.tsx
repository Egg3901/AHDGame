"use client";

import { Tooltip } from "@/components/Tooltip";
import { PlayerSelector } from "@/components/PlayerSelector";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { CAMPAIGN_CATEGORIES, type CampaignData } from "@/lib/campaigns/dto/campaignView";
import { LevelBar } from "./LevelBar";
import { getMaxLevel, type UpgradeCategory } from "@/lib/campaigns/upgradeCosts";

interface OperationsSectionProps {
  campaign: CampaignData;
  isOwner: boolean;
  upgrading: string | null;
  onUpgrade: (category: string, targetId?: string) => void;
  onResetOppositionResearch?: () => void;
  resettingOppositionResearch?: boolean;
}

export function OperationsSection({
  campaign,
  isOwner,
  upgrading,
  onUpgrade,
  onResetOppositionResearch,
  resettingOppositionResearch = false,
}: OperationsSectionProps) {
  // Upgrade costs + funds are in the campaign's local currency; format the face
  // value (useCurrency().formatFull would convert anchor→local → double-count).
  const formatFull = (value: number) => formatCurrencyFaceAmount(value, campaign.currencyCode);
  return (
    <div className="mb-6 rounded-xl border border-card-border bg-card p-5">
      <h2 className="text-lg font-semibold mb-4">
        {isOwner ? "Strategic Operations" : "Campaign Operations"}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {CAMPAIGN_CATEGORIES.map((cat) => {
          const level = campaign.levels[cat.key as keyof typeof campaign.levels];
          const maxLevel = getMaxLevel(cat.key as UpgradeCategory);
          const nextCost =
            campaign.nextUpgradeCosts?.[
              cat.key as keyof NonNullable<typeof campaign.nextUpgradeCosts>
            ];
          const canAfford =
            nextCost &&
            campaign.funds !== undefined &&
            campaign.actions !== undefined &&
            campaign.funds >= nextCost.funds &&
            campaign.actions >= nextCost.actions;

          return (
            <div key={cat.key} className={`rounded-lg border p-4 ${cat.bgClass}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <Tooltip content={cat.tooltipText}>
                    <h3
                      className={`text-sm font-semibold ${cat.colorClass} cursor-help border-b border-dashed border-transparent hover:border-current inline-block`}
                    >
                      {cat.label}
                    </h3>
                  </Tooltip>
                  <p className="text-xs text-muted mt-0.5">{cat.description}</p>
                </div>
                <Tooltip content={`Level ${level} of ${maxLevel}`}>
                  <span className={`font-mono text-lg font-bold ${cat.colorClass} cursor-help`}>
                    {level}
                  </span>
                </Tooltip>
              </div>

              <div className="mb-3">
                <LevelBar level={level} max={maxLevel} barClass={cat.barClass} />
              </div>

              {/* Owner upgrade controls */}
              {isOwner && nextCost && (
                <div className="mt-3 pt-3 border-t border-card-border/50">
                  <div className="flex items-center justify-between text-xs text-muted mb-2">
                    <Tooltip
                      content={`Upgrading to level ${nextCost.level} provides: ${nextCost.effect}`}
                    >
                      <span className="cursor-help border-b border-dashed border-card-border/70">
                        Next: {nextCost.effect}
                      </span>
                    </Tooltip>
                    <div className="flex gap-2 font-mono">
                      <Tooltip
                        content={`Cost: ${formatFull(nextCost.funds)} (you have ${formatFull(campaign.funds!)})`}
                      >
                        <span
                          className={`cursor-help ${campaign.funds! >= nextCost.funds ? "text-amber-400" : "text-error"}`}
                        >
                          {formatFull(nextCost.funds)}
                        </span>
                      </Tooltip>
                      <Tooltip
                        content={`Actions cost: ${nextCost.actions} (you have ${campaign.actions!})`}
                      >
                        <span
                          className={`cursor-help ${campaign.actions! >= nextCost.actions ? "text-cyan-400" : "text-error"}`}
                        >
                          {nextCost.actions}a
                        </span>
                      </Tooltip>
                    </div>
                  </div>
                  {nextCost.maintenance && (
                    <Tooltip
                      content={`This upgrade adds ${formatFull(nextCost.maintenance)} to your per-turn maintenance costs`}
                    >
                      <div className="text-xs text-warning/70 mb-2 cursor-help inline-block">
                        +{formatFull(nextCost.maintenance)}/turn maintenance
                      </div>
                    </Tooltip>
                  )}

                  {cat.requiresTarget ? (
                    <div>
                      <PlayerSelector
                        onSelect={(char) => onUpgrade(cat.key, char.id)}
                        placeholder="Select target to upgrade..."
                        excludeIds={[]}
                        className="w-full"
                      />
                      {campaign.oppositionTargetName && (
                        <div className="mt-1.5 text-xs text-muted">
                          Current target:{" "}
                          <span className="text-foreground font-medium">
                            {campaign.oppositionTargetName}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => onUpgrade(cat.key)}
                      disabled={!canAfford || upgrading === cat.key}
                      className={`w-full py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
                        canAfford && upgrading !== cat.key
                          ? "bg-foreground text-background hover:bg-foreground/90"
                          : "bg-card-border text-muted cursor-not-allowed"
                      }`}
                    >
                      {upgrading === cat.key
                        ? "Upgrading..."
                        : canAfford
                          ? "Upgrade"
                          : "Insufficient Resources"}
                    </button>
                  )}
                </div>
              )}

              {isOwner && !nextCost && (
                <div className="mt-3 pt-3 border-t border-card-border/50 text-center">
                  <span className="text-xs text-muted">Max Level</span>
                </div>
              )}

              {/* Owner-only reset for opposition research */}
              {isOwner &&
                cat.key === "oppositionResearch" &&
                level > 0 &&
                onResetOppositionResearch && (
                  <button
                    type="button"
                    onClick={onResetOppositionResearch}
                    disabled={resettingOppositionResearch}
                    className="mt-2 w-full rounded-md border border-error/30 bg-error/10 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resettingOppositionResearch ? "Resetting..." : "Reset Opposition Research"}
                  </button>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
