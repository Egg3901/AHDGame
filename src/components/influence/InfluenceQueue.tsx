"use client";

import { useState } from "react";
import type { InfluenceType } from "@/lib/db/types";
import { formatLocalFunds } from "@/lib/actions";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface QueueItem {
  id: string;
  nppId: string;
  nppName: string;
  influenceType: InfluenceType;
  actionName: string;
  actionCost: number;
  baseFundCost: number;
  context: { electionId?: string; candidateId?: string; targetStateId?: string };
  contextLabel?: string;
}

export interface QueueResult {
  success: boolean;
  outcome: string;
  message: string;
  nppId: string;
  influenceType: string;
}

export function useInfluenceQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [results, setResults] = useState<QueueResult[] | null>(null);

  function addToQueue(item: Omit<QueueItem, "id">) {
    setQueue((prev) => [...prev, { ...item, id: `${Date.now()}-${Math.random()}` }]);
    setResults(null);
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function clearQueue() {
    setQueue([]);
    setResults(null);
  }

  function getTotalCost() {
    return queue.reduce(
      (acc, item) => ({
        actions: acc.actions + item.actionCost,
        funds: acc.funds + item.baseFundCost,
      }),
      { actions: 0, funds: 0 }
    );
  }

  return { queue, results, setResults, addToQueue, removeFromQueue, clearQueue, getTotalCost };
}

interface InfluenceQueueDisplayProps {
  queue: QueueItem[];
  results: QueueResult[] | null;
  onRemove: (id: string) => void;
  onClear: () => void;
  onExecute: () => void;
  executing: boolean;
  totalActions: number;
  totalFunds: number;
  availableActions: number;
  availableFunds: number;
  /** Currency to format fund totals in (defaults to USD). */
  currency?: CurrencyCode;
  partyColor: string;
}

export function InfluenceQueueDisplay({
  queue,
  results,
  onRemove,
  onClear,
  onExecute,
  executing,
  totalActions,
  totalFunds,
  availableActions,
  availableFunds,
  currency = "USD",
  partyColor,
}: InfluenceQueueDisplayProps) {
  const canAfford = availableActions >= totalActions && availableFunds >= totalFunds;

  if (queue.length === 0 && !results) return null;

  return (
    <div className="mt-4 rounded-lg border border-card-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">
          Action Queue {queue.length > 0 && `(${queue.length})`}
        </h3>
        {queue.length > 0 && !results && (
          <button onClick={onClear} className="text-xs text-muted hover:text-red-400">
            Clear All
          </button>
        )}
        {results && (
          <button onClick={onClear} className="text-xs text-muted hover:text-primary">
            New Queue
          </button>
        )}
      </div>

      {/* Results display */}
      {results && (
        <div className="space-y-2 mb-3">
          {results.map((r, i) => (
            <div
              key={i}
              className={`rounded-md px-3 py-2 text-xs ${
                r.outcome === "success"
                  ? "bg-green-500/20 text-green-400"
                  : r.outcome === "backfire"
                    ? "bg-red-500/20 text-red-400"
                    : r.outcome === "error"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-yellow-500/20 text-yellow-400"
              }`}
            >
              {r.message}
            </div>
          ))}
          <ResultsSummary results={results} />
        </div>
      )}

      {/* Queue items */}
      {!results && queue.length > 0 && (
        <>
          <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
            {queue.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-xs"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{item.actionName}</span>
                  <span className="text-muted"> on </span>
                  <span className="font-medium">{item.nppName}</span>
                  {item.contextLabel && <span className="text-muted"> {item.contextLabel}</span>}
                </div>
                <button
                  onClick={() => onRemove(item.id)}
                  className="ml-2 text-muted hover:text-red-400 shrink-0"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          {/* Total cost */}
          <div className="rounded-md bg-background p-3 mb-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Total Action Points:</span>
              <span className={totalActions > availableActions ? "text-red-400 font-medium" : ""}>
                {totalActions} / {availableActions}
              </span>
            </div>
            {(totalFunds > 0 || availableFunds > 0) && (
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-muted">Total Funds:</span>
                <span
                  className={
                    totalFunds > availableFunds ? "text-red-400 font-medium" : "text-green-400"
                  }
                >
                  {formatLocalFunds(totalFunds, currency)} /{" "}
                  {formatLocalFunds(availableFunds, currency)}
                </span>
              </div>
            )}
          </div>

          {/* Execute button */}
          <button
            onClick={onExecute}
            disabled={executing || !canAfford || queue.length === 0}
            className="w-full rounded-lg py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: partyColor }}
          >
            {executing
              ? "Executing..."
              : `Execute All (${queue.length} action${queue.length !== 1 ? "s" : ""})`}
          </button>
        </>
      )}
    </div>
  );
}

function ResultsSummary({ results }: { results: QueueResult[] }) {
  const successes = results.filter((r) => r.outcome === "success").length;
  const failures = results.filter((r) => r.outcome === "failure").length;
  const backfires = results.filter((r) => r.outcome === "backfire").length;
  const errors = results.filter((r) => r.outcome === "error").length;

  return (
    <div className="rounded-md bg-background p-2 text-xs text-muted">
      <span className="font-medium">Summary:</span>{" "}
      {successes > 0 && <span className="text-green-400">{successes} success </span>}
      {failures > 0 && <span className="text-yellow-400">{failures} failure </span>}
      {backfires > 0 && <span className="text-red-400">{backfires} backfire </span>}
      {errors > 0 && <span className="text-red-400">{errors} error </span>}
      <span>
        out of {results.length} attempt{results.length !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
