"use client";

import Link from "next/link";
import { regionPartyUrl } from "@/lib/urls";

/**
 * Read-only summary of the viewer-party's voter-suppression budget for
 * this state. Same shape as `GotvDriveCard`. Mutation lives on the
 * State Party page (Phase 2 D2).
 *
 * See plan §"Phase 2 — Task 2.1".
 */
export function SuppressionCounterOpsCard({
  countryCode,
  stateId,
  partyId,
  budgetPercent,
  targetCategory,
  targetGroup,
}: {
  countryCode: string;
  stateId: string;
  partyId: string;
  /** 0..25 percent of hourly revenue — `undefined` when no budget row exists. */
  budgetPercent: number | undefined;
  /** Demographic category the suppression is targeting, if any. */
  targetCategory?: string;
  /** Specific group within `targetCategory`, if any. */
  targetGroup?: string;
}) {
  const url = regionPartyUrl(countryCode, stateId, partyId);
  const hasBudget = budgetPercent != null && budgetPercent > 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
        Suppression Counter-Ops
      </h3>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">
          {budgetPercent != null ? `${budgetPercent.toFixed(1)}%` : "—"}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted">of hourly revenue</span>
      </div>
      {hasBudget && targetCategory && (
        <p className="mt-1 text-xs">
          Targeting{" "}
          <span className="font-semibold">
            {targetGroup ? `${targetGroup} (${targetCategory})` : targetCategory}
          </span>
        </p>
      )}
      {!hasBudget && (
        <p className="mt-1 text-xs italic opacity-70">No suppression budget set for this state.</p>
      )}
      <Link
        href={url}
        className="mt-3 inline-block text-xs font-medium underline opacity-80 hover:opacity-100"
      >
        Adjust on State Party page →
      </Link>
    </div>
  );
}
