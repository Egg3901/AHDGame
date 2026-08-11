"use client";

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useCurrency } from "@/contexts/CurrencyContext";
import { BATCHABLE_ACTION_TYPES, simulateActionBatch } from "@/lib/actions";
import type { ActionType, Character, State } from "@/lib/db/types";

type BatchCount = 5 | 10;

export interface ActionExecuteRowProps {
  actionType: string;
  character: Character;
  homeState: State | null;
  blocked: boolean;
  executingKey: string | null;
  onExecute: (type: string, count?: 1 | 5 | 10) => void;
  /** Compact layout for grid row (smaller controls). */
  compact?: boolean;
  /** Must match execute route so batch previews use the same fund pool as the server. */
  forexEnabled?: boolean;
}

export default function ActionExecuteRow({
  actionType,
  character,
  homeState,
  blocked,
  executingKey,
  onExecute,
  compact,
  forexEnabled = false,
}: ActionExecuteRowProps) {
  const { formatAmount } = useCurrency();
  const [confirmCount, setConfirmCount] = useState<BatchCount | null>(null);

  const state = homeState ?? undefined;

  const batchable = useMemo(
    () => BATCHABLE_ACTION_TYPES.includes(actionType as ActionType),
    [actionType]
  );

  const sim5 = useMemo(() => {
    if (!batchable) return null;
    return simulateActionBatch(character, state, actionType as ActionType, 5, forexEnabled);
  }, [batchable, character, state, actionType, forexEnabled]);

  const sim10 = useMemo(() => {
    if (!batchable) return null;
    return simulateActionBatch(character, state, actionType as ActionType, 10, forexEnabled);
  }, [batchable, character, state, actionType, forexEnabled]);

  const can5 = batchable && sim5?.ok;
  const can10 = batchable && sim10?.ok;

  const execKey = actionType;
  const execKey5 = `${actionType}:5`;
  const execKey10 = `${actionType}:10`;

  const isBusy =
    executingKey === execKey || executingKey === execKey5 || executingKey === execKey10;

  const btnBase = compact
    ? "rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm"
    : "rounded-lg px-3 py-2 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed";

  const primary = compact
    ? isBusy && executingKey === execKey
      ? "bg-white/20 cursor-wait text-white"
      : "bg-primary hover:bg-primary-dark text-white"
    : isBusy && executingKey === execKey
      ? "bg-muted cursor-wait text-white"
      : "bg-primary hover:bg-primary-dark hover:shadow-primary/20 text-white shadow-md";

  const batchIdle = compact
    ? "border border-white/15 bg-white/10 text-white hover:bg-white/20 hover:border-white/30"
    : "border border-card-border bg-card-elevated text-foreground hover:bg-primary/10 hover:border-primary/30";

  const pendingConfirm = confirmCount === 5 ? sim5 : confirmCount === 10 ? sim10 : null;

  return (
    <>
      <div
        className={`flex flex-wrap items-center gap-1.5 ${compact ? "justify-end sm:flex-nowrap w-full sm:w-auto" : ""}`}
      >
        <button
          type="button"
          onClick={() => onExecute(actionType, 1)}
          disabled={blocked || isBusy}
          className={`${btnBase} ${primary} ${compact ? "min-w-[72px] flex-1 sm:flex-none" : "shadow-md flex-1 min-w-0 sm:flex-none"}`}
        >
          {executingKey === execKey
            ? compact
              ? "..."
              : "Executing..."
            : compact
              ? "Execute"
              : "Execute Action"}
        </button>

        {batchable && (
          <>
            <button
              type="button"
              onClick={() => setConfirmCount(5)}
              disabled={blocked || isBusy || !can5}
              title={!can5 && sim5 && !sim5.ok ? sim5.reason : undefined}
              className={`${btnBase} ${batchIdle} ${!can5 ? "opacity-40" : ""} ${compact ? "min-w-[36px]" : ""}`}
            >
              ×5
            </button>
            <button
              type="button"
              onClick={() => setConfirmCount(10)}
              disabled={blocked || isBusy || !can10}
              title={!can10 && sim10 && !sim10.ok ? sim10.reason : undefined}
              className={`${btnBase} ${batchIdle} ${!can10 ? "opacity-40" : ""} ${compact ? "min-w-[36px]" : ""}`}
            >
              ×10
            </button>
          </>
        )}
      </div>

      {confirmCount &&
        pendingConfirm?.ok &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={() => setConfirmCount(null)}
          >
            <div
              className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-card-border bg-card p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="batch-confirm-title"
            >
              <h2
                id="batch-confirm-title"
                className="text-heading-sm font-semibold text-foreground"
              >
                Run ×{confirmCount}?
              </h2>
              <p className="mt-2 text-body-sm text-muted">
                This will spend{" "}
                <span className="font-semibold text-foreground">
                  {pendingConfirm.totalActionPoints} AP
                </span>{" "}
                total and change campaign funds by{" "}
                <span
                  className={`font-semibold ${pendingConfirm.netFundsChange >= 0 ? "text-success" : "text-error"}`}
                >
                  {pendingConfirm.netFundsChange >= 0 ? "+" : ""}
                  {formatAmount(pendingConfirm.netFundsChange)}
                </span>
                .
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmCount(null)}
                  className="rounded-lg border border-card-border bg-card-elevated px-4 py-2 text-sm font-semibold text-foreground hover:bg-card-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const c = confirmCount;
                    setConfirmCount(null);
                    onExecute(actionType, c);
                  }}
                  disabled={isBusy}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
                >
                  Confirm ×{confirmCount}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
