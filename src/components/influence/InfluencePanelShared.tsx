"use client";

import type { InfluenceResult } from "./useInfluencePanelState";
import { formatLocalFunds } from "@/lib/actions";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Shared loading state for influence panels.
 */
export function InfluencePanelLoading() {
  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="text-center text-muted">Loading influence options...</div>
    </div>
  );
}

/**
 * Shared error state for influence panels.
 */
export function InfluencePanelError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
      <div className="text-red-400">{message}</div>
    </div>
  );
}

/**
 * Shared result message display for influence panels.
 */
export function InfluenceResultMessage({ result }: { result: InfluenceResult }) {
  return (
    <div
      role="status"
      className={`mb-4 rounded-lg p-3 text-sm ${
        result.success
          ? "bg-green-500/20 text-green-400"
          : result.outcome === "backfire"
            ? "bg-red-500/20 text-red-400"
            : "bg-yellow-500/20 text-yellow-400"
      }`}
    >
      {result.message}
    </div>
  );
}

/**
 * Inline error message for influence panels.
 */
export function InfluenceErrorMessage({ message }: { message: string }) {
  return (
    <div role="alert" className="mb-4 rounded-lg bg-red-500/20 p-3 text-sm text-red-400">
      {message}
    </div>
  );
}

/**
 * Cooldown warning for influence panels.
 */
export function InfluenceCooldownWarning({ turnsRemaining }: { turnsRemaining: number }) {
  return (
    <div className="mb-4 rounded-lg bg-yellow-500/20 p-3 text-sm text-yellow-400">
      Cooldown: Wait {turnsRemaining} more turn(s) before attempting to influence this NPP again.
    </div>
  );
}

interface CostAndChanceSummaryProps {
  actionCost: number;
  fundCost: number;
  /** Currency to format the fund cost in (defaults to USD). */
  currency?: CurrencyCode;
  estimatedChance: number;
  successLabel?: string;
}

/**
 * Shared cost and chance summary for influence panels.
 */
export function CostAndChanceSummary({
  actionCost,
  fundCost,
  currency = "USD",
  estimatedChance,
  successLabel,
}: CostAndChanceSummaryProps) {
  const isLikely = estimatedChance >= 50;
  const chipLabel = successLabel ?? (isLikely ? "Likely to Accept" : "Likely to Decline");

  return (
    <div className="rounded-lg bg-background p-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-muted">Action Cost:</span>{" "}
          <span className="font-medium">{actionCost}</span>
        </div>
        {fundCost > 0 && (
          <div>
            <span className="text-muted">Fund Cost:</span>{" "}
            <span className="font-medium text-green-400">
              {formatLocalFunds(fundCost, currency)}
            </span>
          </div>
        )}
        <div className="col-span-2">
          <span className="text-muted">Estimated Response:</span>{" "}
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
              isLikely
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-red-500/40 bg-red-500/15 text-red-300"
            }`}
          >
            {chipLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

interface CharacterResourcesProps {
  actions: number;
  funds: number;
  /** Optional candidate NPI to display */
  candidateNPI?: number | null;
}

/**
 * Shared character resources display for influence panels.
 */
export function CharacterResources({ actions, funds, candidateNPI }: CharacterResourcesProps) {
  return (
    <div className="mb-4 flex flex-wrap gap-4 text-sm">
      <div>
        <span className="text-muted">Actions: </span>
        <span className="font-medium">{actions}</span>
      </div>
      <div>
        <span className="text-muted">Funds: </span>
        <span className="font-medium text-green-400">${funds.toLocaleString("en-US")}</span>
      </div>
      {candidateNPI != null && (
        <div>
          <span className="text-muted">Candidate NPI: </span>
          <span className="font-medium text-purple-400">{candidateNPI.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

interface ExecuteButtonProps {
  executing: boolean;
  disabled: boolean;
  onClick: () => void;
  label?: string;
  executingLabel?: string;
}

/**
 * Shared execute button for influence panels.
 */
export function ExecuteInfluenceButton({
  executing,
  disabled,
  onClick,
  label = "Attempt Influence",
  executingLabel = "Attempting...",
}: ExecuteButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={executing || disabled}
      className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
    >
      {executing ? executingLabel : label}
    </button>
  );
}
