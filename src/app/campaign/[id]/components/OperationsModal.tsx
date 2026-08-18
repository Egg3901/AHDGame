"use client";

import { useEffect } from "react";
import { PlayerSelector } from "@/components/PlayerSelector";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CampaignData, OpsTreeView, OpsBranchView } from "@/lib/campaigns/dto/campaignView";
import { LevelBar } from "./LevelBar";

interface CategoryMeta {
  key: string;
  label: string;
  description: string;
  colorClass: string;
  bgClass: string;
  barClass: string;
}

interface OperationsModalProps {
  campaign: CampaignData;
  category: CategoryMeta;
  tree: OpsTreeView;
  upgrading: string | null;
  onUpgrade: (category: string, branch?: "a" | "b" | "c" | null, targetId?: string) => void;
  onRetarget?: (targetId: string) => void;
  onResetOppositionResearch?: () => void;
  resettingOppositionResearch?: boolean;
  onClose: () => void;
}

/**
 * Strategic Operations v2 — per-lever tree modal. Shows the tier-1 starter node
 * and three branch sub-tracks. Mobile-first: branches stack in one column and
 * the dialog fills the viewport; on >=sm it becomes a centered card with the
 * three branches side by side.
 */
export function OperationsModal({
  campaign,
  category,
  tree,
  upgrading,
  onUpgrade,
  onRetarget,
  onResetOppositionResearch,
  resettingOppositionResearch = false,
  onClose,
}: OperationsModalProps) {
  const fmt = (v: number) => formatCurrencyFaceAmount(v, campaign.currencyCode);
  const funds = campaign.funds ?? 0;
  const actions = campaign.actions ?? 0;
  const requiresTarget = tree.requiresTarget;

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canAfford = (cost: { funds: number; actions: number } | null) =>
    !!cost && funds >= cost.funds && actions >= cost.actions;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${category.label} operations`}
    >
      <div
        className="flex h-full w-full flex-col overflow-y-auto bg-card sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-xl sm:border sm:border-card-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-card-border bg-card p-4">
          <div>
            <h2 className={`text-lg font-semibold ${category.colorClass}`}>{category.label}</h2>
            <p className="mt-0.5 text-xs text-muted">{category.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-muted hover:bg-card-border/40 hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {/* Starter node */}
          <StarterNode
            category={category}
            tree={tree}
            fmt={fmt}
            requiresTarget={requiresTarget}
            canAfford={canAfford}
            upgrading={upgrading}
            onUpgrade={onUpgrade}
          />

          {/* Opposition research target controls (unlocked only) */}
          {tree.unlocked && requiresTarget && (
            <div className="rounded-lg border border-card-border bg-background/40 p-3">
              <div className="mb-1 text-xs font-medium text-muted">
                {campaign.oppositionTargetName ? "Current target" : "No target selected"}
              </div>
              {campaign.oppositionTargetName && (
                <div className="mb-2 text-sm font-semibold text-foreground">
                  {campaign.oppositionTargetName}
                </div>
              )}
              {onRetarget && (
                <PlayerSelector
                  onSelect={(char) => onRetarget(char.id)}
                  placeholder="Change target..."
                  excludeIds={campaign.candidateId ? [campaign.candidateId] : []}
                  className="w-full"
                />
              )}
              {onResetOppositionResearch && (
                <button
                  type="button"
                  onClick={onResetOppositionResearch}
                  disabled={resettingOppositionResearch}
                  className="mt-2 w-full rounded-md border border-error/30 bg-error/10 py-1.5 text-xs font-medium text-error hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resettingOppositionResearch ? "Resetting..." : "Reset Opposition Research"}
                </button>
              )}
            </div>
          )}

          {/* Branch sub-tracks */}
          <div
            className={`grid grid-cols-1 gap-3 ${tree.unlocked ? "sm:grid-cols-3" : "opacity-50"}`}
          >
            {tree.branches.map((branch) => (
              <BranchCard
                key={branch.key}
                category={category}
                branch={branch}
                unlocked={tree.unlocked}
                fmt={fmt}
                canAfford={canAfford}
                upgrading={upgrading}
                onUpgrade={onUpgrade}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StarterNode({
  category,
  tree,
  fmt,
  requiresTarget,
  canAfford,
  upgrading,
  onUpgrade,
}: {
  category: CategoryMeta;
  tree: OpsTreeView;
  fmt: (v: number) => string;
  requiresTarget: boolean;
  canAfford: (c: { funds: number; actions: number } | null) => boolean;
  upgrading: string | null;
  onUpgrade: (category: string, branch?: "a" | "b" | "c" | null, targetId?: string) => void;
}) {
  if (tree.unlocked) {
    return (
      <div className={`rounded-lg border p-3 ${category.bgClass}`}>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-semibold ${category.colorClass}`}>Operation Active</span>
          <span className="text-xs font-medium text-success">Unlocked ✓</span>
        </div>
        <p className="mt-0.5 text-xs text-muted">{tree.starterEffect}</p>
      </div>
    );
  }

  const cost = tree.starterCost;
  const busy = upgrading === category.key;
  const affordable = canAfford(cost);

  return (
    <div className={`rounded-lg border p-3 ${category.bgClass}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-sm font-semibold ${category.colorClass}`}>Unlock Operation</span>
        {cost && (
          <span className="font-mono text-xs text-muted">
            {fmt(cost.funds)} · {cost.actions}a
          </span>
        )}
      </div>
      <p className="mb-2 text-xs text-muted">{tree.starterEffect}</p>
      {requiresTarget && (
        <p className="mb-2 text-xs text-warning/80">
          Select a target below to begin opposition research.
        </p>
      )}
      {requiresTarget ? (
        <PlayerSelector
          onSelect={(char) => onUpgrade(category.key, null, char.id)}
          placeholder="Select target to unlock..."
          excludeIds={[]}
          className="w-full"
        />
      ) : (
        <button
          type="button"
          onClick={() => onUpgrade(category.key, null)}
          disabled={!affordable || busy}
          className={`w-full rounded-lg py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
            affordable && !busy
              ? "bg-foreground text-background hover:bg-foreground/90"
              : "cursor-not-allowed bg-card-border text-muted"
          }`}
        >
          {busy ? "Unlocking..." : affordable ? "Unlock" : "Insufficient Resources"}
        </button>
      )}
    </div>
  );
}

function BranchCard({
  category,
  branch,
  unlocked,
  fmt,
  canAfford,
  upgrading,
  onUpgrade,
}: {
  category: CategoryMeta;
  branch: OpsBranchView;
  unlocked: boolean;
  fmt: (v: number) => string;
  canAfford: (c: { funds: number; actions: number } | null) => boolean;
  upgrading: string | null;
  onUpgrade: (category: string, branch?: "a" | "b" | "c" | null, targetId?: string) => void;
}) {
  const maxed = branch.level >= branch.maxLevel;
  const cost = branch.next;
  const busy = upgrading === `${category.key}:${branch.key}`;
  const affordable = canAfford(cost);

  return (
    <div className="flex flex-col rounded-lg border border-card-border bg-background/40 p-3">
      <div className="flex items-start justify-between">
        <span className="text-sm font-semibold text-foreground">{branch.label}</span>
        <span className={`font-mono text-sm font-bold ${category.colorClass}`}>{branch.level}</span>
      </div>
      <p className="mt-0.5 mb-2 text-xs text-muted">{branch.description}</p>
      <div className="mb-2">
        <LevelBar level={branch.level} max={branch.maxLevel} barClass={category.barClass} />
      </div>

      {!unlocked ? (
        <div className="mt-auto text-center text-xs text-muted">Locked</div>
      ) : maxed ? (
        <div className="mt-auto text-center text-xs text-muted">Max Level</div>
      ) : (
        cost && (
          <div className="mt-auto">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted">{cost.effect}</span>
              <span className="font-mono text-muted">
                {fmt(cost.funds)} · {cost.actions}a
              </span>
            </div>
            {cost.maintenance ? (
              <div className="mb-1 text-[11px] text-warning/70">
                +{fmt(cost.maintenance)}/turn upkeep
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onUpgrade(category.key, branch.key)}
              disabled={!affordable || busy}
              className={`w-full rounded-lg py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                affordable && !busy
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "cursor-not-allowed bg-card-border text-muted"
              }`}
            >
              {busy ? "..." : affordable ? "Upgrade" : "Can't Afford"}
            </button>
          </div>
        )
      )}
    </div>
  );
}
