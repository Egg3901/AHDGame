"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { apiErrorText } from "@/lib/errors/catalog";
import type { OfficePoolKind, OfficePoolTopUpStatus } from "@/lib/actions/officePoolTopUpRules";

export type OfficePoolTopUpBody =
  | { pool: Extract<OfficePoolKind, "ministerial">; positionId: string }
  | { pool: Extract<OfficePoolKind, "vp"> }
  | { pool: Extract<OfficePoolKind, "justice">; seatNumber: number }
  | { pool: Extract<OfficePoolKind, "gubernatorial">; stateId: string };

interface OfficePoolTopUpButtonProps {
  countryCode: string;
  body: OfficePoolTopUpBody;
  remaining: number;
  cap: number;
  /** Holder-only top-up state from the office GET; null hides the button. */
  topUp: OfficePoolTopUpStatus | null | undefined;
  onUpdate: () => void;
  className?: string;
}

/** Disabled reason for the holder, or null when the purchase is allowed. */
export function officePoolTopUpDisabledReason(topUp: OfficePoolTopUpStatus): string | null {
  if (topUp.usedThisTurn) return "Already bought one this turn.";
  if (topUp.playerActions < topUp.cost) {
    return `Needs ${topUp.cost} AP (you have ${Math.floor(topUp.playerActions)}).`;
  }
  return null;
}

/**
 * "Buy 1 action" control for an office action pool: spends main AP for +1
 * office action, once per pool per turn. Shown only to the holder (the GET
 * route sends `topUp` only for them) and only while the pool is below cap.
 */
export function OfficePoolTopUpButton({
  countryCode,
  body,
  remaining,
  cap,
  topUp,
  onUpdate,
  className = "",
}: OfficePoolTopUpButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!topUp || remaining >= cap) return null;
  const cost = topUp.cost;
  const reason = officePoolTopUpDisabledReason(topUp);

  async function handleBuy() {
    if (busy || reason) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/country/${countryCode}/office-pool/top-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(apiErrorText(json, "Could not buy an action"));
        return;
      }
      onUpdate();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col items-end gap-1 ${className}`.trim()}>
      <Button
        variant="secondary"
        size="sm"
        disabled={reason != null}
        isLoading={busy}
        onClick={handleBuy}
        title={reason ?? undefined}
      >
        Buy 1 action ({cost} AP)
      </Button>
      {reason && <p className="text-xs text-muted">{reason}</p>}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
