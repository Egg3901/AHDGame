"use client";

import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import { BillCard } from "./BillCard";
import { BillListItem, BillListStack } from "./BillListItem";

/**
 * Legislative record bill list: a stack of card-surfaced {@link BillCard} rows.
 * Shared by US Congress and every country legislature so the look stays identical.
 */
export function BillsList({
  bills,
  onVoted,
  emptyText = "No bills match the current filter.",
}: {
  bills: BillDisplay[];
  onVoted?: () => void;
  emptyText?: string;
}) {
  if (bills.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-10 text-center shadow-card">
        <p className="text-sm text-muted">{emptyText}</p>
      </div>
    );
  }
  return (
    <BillListStack>
      {bills.map((bill) => (
        <BillListItem key={bill.id}>
          <BillCard bill={bill} onVoted={onVoted} />
        </BillListItem>
      ))}
    </BillListStack>
  );
}
