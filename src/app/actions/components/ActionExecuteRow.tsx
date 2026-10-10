"use client";

import { useWorldFlags } from "@/hooks/useWorldFlags";
import { campaignLocalRate, getCampaignCurrency } from "@/lib/campaigns/rules/currency";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useCurrency } from "@/contexts/CurrencyContext";
import { BATCHABLE_ACTION_TYPES, getBatchAffordability, simulateActionBatch } from "@/lib/actions";
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
  const { baseRates } = useCurrency();
  const { preset, campaignPriceLevel } = useWorldFlags();
  const campaignRate = forexEnabled ? campaignLocalRate(character.countryId ?? "US", baseRates) : 1;
  const [confirmCount, setConfirmCount] = useState<BatchCount | null>(null);

  const state = homeState ?? undefined;

  const batchable = useMemo(
    () => BATCHABLE_ACTION_TYPES.includes(actionType as ActionType),
    [actionType]
  );

  const sim5 = useMemo(() => {
    if (!batchable) return null;
    return simulateActionBatch(
      character,
      state,
      actionType as ActionType,
      5,
      forexEnabled,
      campaignRate,
      { preset, priceLevel: campaignPriceLevel }
    );
  }, [
    batchable,
    character,
    state,
    actionType,
    forexEnabled,
    campaignRate,
    preset,
    campaignPriceLevel,
  ]);

  const sim10 = useMemo(() => {
    if (!batchable) return null;
    return simulateActionBatch(
      character,
      state,
      actionType as ActionType,
      10,
      forexEnabled,
      campaignRate,
      { preset, priceLevel: campaignPriceLevel }
    );
  }, [
    batchable,
    character,
    state,
    actionType,
    forexEnabled,
    campaignRate,
    preset,
    campaignPriceLevel,
  ]);

  const can5 = batchable && sim5?.ok;
  const can10 = batchable && sim10?.ok;

  // Only computed when a batch is refused, to tell the player how far they can go.
  const afford5 = useMemo(
    () =>
      batchable && !can5
        ? getBatchAffordability(
            character,
            state,
            actionType as ActionType,
            5,
            forexEnabled,
            campaignRate,
            {
              preset,
              priceLevel: campaignPriceLevel,
            }
          )
        : null,
    [
      batchable,
      can5,
      character,
      state,
      actionType,
      forexEnabled,
      campaignRate,
      preset,
      campaignPriceLevel,
    ]
  );
  const afford10 = useMemo(
    () =>
      batchable && !can10
        ? getBatchAffordability(
            character,
            state,
            actionType as ActionType,
            10,
            forexEnabled,
            campaignRate,
            {
              preset,
              priceLevel: campaignPriceLevel,
            }
          )
        : null,
    [
      batchable,
      can10,
      character,
      state,
      actionType,
      forexEnabled,
      campaignRate,
      preset,
      campaignPriceLevel,
    ]
  );

  const execKey = actionType;
  const execKey5 = `${actionType}:5`;
  const execKey10 = `${actionType}:10`;

  const isBusy =
    executingKey === execKey || executingKey === execKey5 || executingKey === execKey10;

  const btnBase = compact
    ? "rounded-md px-2.5 py-1.5 text-body-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    : "rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  const primary =
    isBusy && executingKey === execKey
      ? "bg-muted cursor-wait text-white"
      : "bg-primary hover:bg-primary-dark text-white";

  const batchIdle =
    "border border-card-border bg-card-elevated text-foreground hover:bg-card-muted";

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
          className={`${btnBase} ${primary} ${compact ? "min-w-[72px] flex-1 sm:flex-none" : "flex-1 min-w-0 sm:flex-none"}`}
        >
          {executingKey === execKey
            ? compact
              ? "..."
              : "Executing..."
            : compact
              ? "Execute"
              : "Execute action"}
        </button>

        {batchable && (
          <>
            <button
              type="button"
              onClick={() => setConfirmCount(5)}
              disabled={blocked || isBusy || !can5}
              title={afford5?.title}
              className={`${btnBase} ${batchIdle} ${!can5 ? "opacity-40" : ""} ${compact ? "min-w-[36px]" : ""}`}
            >
              ×5
            </button>
            <button
              type="button"
              onClick={() => setConfirmCount(10)}
              disabled={blocked || isBusy || !can10}
              title={afford10?.title}
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
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
            onClick={() => setConfirmCount(null)}
          >
            <div
              className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-card-border bg-card p-5 shadow-modal"
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
                  {formatCurrencyFaceAmount(
                    pendingConfirm.netFundsChange * campaignRate,
                    getCampaignCurrency(character.countryId ?? "US")
                  )}
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
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
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
