"use client";

import { useState } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { ActionRecommendation, RecommendationPriority } from "@/lib/actions/recommendations";

interface Props {
  recommendation: ActionRecommendation;
  onDismiss: (id: string) => void;
  onExecute?: (recommendation: ActionRecommendation) => void;
  executing?: string | null;
  canExecuteInline: boolean;
}

const priorityConfig: Record<
  RecommendationPriority,
  { badgeClass: string; borderClass: string; dotClass: string; label: string }
> = {
  critical: {
    badgeClass: "bg-error/15 text-error border border-error/30",
    borderClass: "border-error/40",
    dotClass: "bg-error animate-pulse",
    label: "Critical",
  },
  high: {
    badgeClass: "bg-warning/15 text-warning border border-warning/30",
    borderClass: "border-warning/40",
    dotClass: "bg-warning",
    label: "High",
  },
  medium: {
    badgeClass: "bg-primary/15 text-primary border border-primary/30",
    borderClass: "border-primary/30",
    dotClass: "bg-primary",
    label: "Medium",
  },
  low: {
    badgeClass: "bg-card-muted text-muted border border-card-border",
    borderClass: "border-card-border",
    dotClass: "bg-muted",
    label: "Low",
  },
};

const categoryLabels: Record<string, string> = {
  "getting-started": "Getting Started",
  "stat-recovery": "Stat Recovery",
  "resource-opt": "Resources",
  "market-opportunity": "Market",
  competitive: "Competitive",
  party: "Party",
};

const INLINE_ACTIONS = new Set([
  "fundraise",
  "campaign",
  "advertise",
  "buildDonorBase",
  "rest",
  "convertCash",
]);

export function RecommendationCard({
  recommendation,
  onDismiss,
  onExecute,
  executing,
  canExecuteInline,
}: Props) {
  const { formatAmount } = useCurrency();
  const [expanded, setExpanded] = useState(false);
  const config = priorityConfig[recommendation.priority];
  const isRunning = executing === recommendation.id;

  const isInlineExecutable =
    canExecuteInline && INLINE_ACTIONS.has(recommendation.action.type) && !!onExecute;

  const apCost = recommendation.action.estimatedCost.ap;
  const fundsCost = recommendation.action.estimatedCost.funds;

  return (
    <div
      className={`rounded-xl border bg-card transition-colors hover:bg-card-elevated ${config.borderClass}`}
    >
      <div className="p-4">
        {/* Top row: badge + category + dismiss */}
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${config.badgeClass}`}
            >
              {config.label}
            </span>
            <span className="text-[11px] text-muted">
              {categoryLabels[recommendation.category] ?? recommendation.category}
            </span>
          </div>
          <button
            onClick={() => onDismiss(recommendation.id)}
            className="shrink-0 text-muted hover:text-foreground transition-colors p-0.5"
            title="Dismiss"
            aria-label="Dismiss recommendation"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Title */}
        <p className="text-sm font-semibold text-foreground mb-1.5">{recommendation.title}</p>

        {/* Why */}
        <p className="text-xs text-muted leading-relaxed mb-3">{recommendation.why}</p>

        {/* Details (expanded) */}
        {expanded && (
          <div className="mb-3 p-3 rounded-lg bg-card-muted border border-card-border space-y-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {apCost > 0 || fundsCost > 0 ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-muted font-medium">Cost:</span>
                  <span>
                    {apCost > 0 && <span className="text-warning">{apCost} AP</span>}
                    {apCost > 0 && fundsCost > 0 && <span className="text-muted"> + </span>}
                    {fundsCost > 0 && (
                      <span className="text-secondary">{formatAmount(fundsCost)}</span>
                    )}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-muted font-medium">Cost:</span>
                  <span className="text-muted">Varies</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-muted font-medium">Benefit:</span>
                <span className="text-success">{recommendation.action.estimatedBenefit}</span>
              </div>
            </div>
            {(recommendation.action.targetState || recommendation.action.targetSectorType) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="text-muted font-medium">Target:</span>
                <span className="text-foreground">
                  {recommendation.action.targetStateName ?? recommendation.action.targetState}
                </span>
                {recommendation.action.targetSectorType && (
                  <span className="text-muted">· {recommendation.action.targetSectorType}</span>
                )}
                {recommendation.action.targetUnownedRevenue != null && (
                  <span className="text-success font-medium">
                    · {formatAmount(recommendation.action.targetUnownedRevenue)} unowned
                  </span>
                )}
                <Link
                  href={recommendation.link}
                  className="ml-auto text-primary hover:underline font-medium"
                >
                  View sector →
                </Link>
              </div>
            )}
            {recommendation.action.targetPartyName && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted font-medium">Party:</span>
                <span className="text-foreground">{recommendation.action.targetPartyName}</span>
              </div>
            )}
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center gap-2">
          {isInlineExecutable ? (
            <button
              onClick={() => onExecute!(recommendation)}
              disabled={isRunning || !!executing}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning ? "Executing…" : "Execute"}
            </button>
          ) : (
            <Link
              href={recommendation.link}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Go to Page →
            </Link>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-card-border bg-card hover:bg-card-elevated transition-colors text-muted hover:text-foreground"
          >
            {expanded ? "Hide" : "Details"}
          </button>

          {recommendation.expiresAt && (
            <span className="text-[11px] text-muted ml-auto">
              Expires turn {recommendation.expiresAt}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
