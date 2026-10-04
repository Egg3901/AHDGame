"use client";

import { useEffect, useState } from "react";
import type { CorporationDetail } from "../CorporationPageTypes";
import { InlineStatus, SmallButton } from "../dense/DenseKit";
import { GovernanceRow } from "./GovernanceRow";

/**
 * Hand day-to-day operation of the corp to an autonomous NPP caretaker, or
 * reclaim it (NPP-autonomy V2.1). Only rendered where caretakers are enabled for
 * the corp's country (v2). The owner keeps ownership and reclaim access while
 * the NPP controls operations.
 */
export function CaretakerCeoCard({
  corporation,
  corpId,
  onRefresh,
}: {
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/npps/eligible-caretakers?country=${corporation.countryId}`)
      .then((res) => res.json())
      .then((data: { enabled?: boolean }) => {
        if (!cancelled) setEnabled(data.enabled === true);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [corporation.countryId]);

  if (!enabled) return null;

  // A caretaker (NPP) runs the corp when the seat is filled but by no character.
  const isCaretakerRun = !corporation.ceoVacant && !corporation.ceoCharacterId;

  // Post-reclaim cooldown: a corp reclaimed recently can't hand off again yet.
  const cooldownTurns = corporation.caretakerReappointCooldownTurnsRemaining ?? 0;
  const onCooldown = !isCaretakerRun && cooldownTurns > 0;
  // 1 turn = 1 real hour; surface the wait in whole hours (rounded up).
  const cooldownHours = Math.ceil(cooldownTurns);

  async function appoint() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/caretaker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`${data.nppName ?? "An NPP caretaker"} now runs the corporation.`);
        onRefresh();
      } else {
        setError((data as { error?: string }).error ?? "Failed to appoint caretaker");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/caretaker`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setSuccess("You have resumed control of the corporation.");
        onRefresh();
      } else {
        setError((data as { error?: string }).error ?? "Failed to dismiss caretaker");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function setMandate(mandate: "active" | "passive") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/caretaker`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mandate }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error((data as { error?: string }).error ?? "Failed to update mandate");
      setSuccess(mandate === "passive" ? "Caretaker is now passive." : "Caretaker is now active.");
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const mandate = corporation.caretakerMandate ?? "active";

  return (
    <GovernanceRow
      label="NPP caretaker"
      summary={
        isCaretakerRun
          ? `A caretaker runs the corporation (${mandate}). You remain the owner.`
          : onCooldown
            ? `You resumed control recently. Available again in ${cooldownHours} ${cooldownHours === 1 ? "hour" : "hours"}.`
            : "You run the corporation."
      }
      actionLabel={isCaretakerRun ? "Manage" : "Hand over"}
      disabled={onCooldown}
      disabledReason="Cooling down after you resumed control."
    >
      <div className="space-y-2">
        <p className="text-xs text-muted">
          {isCaretakerRun
            ? "An autonomous NPP caretaker is running this corporation on your behalf. You remain the owner and can resume control immediately. After an owner-initiated handoff, a cooldown of three real days applies before you can hand it back to a caretaker."
            : "Hand day-to-day operation to an autonomous NPP caretaker. It runs the corporation under the same bounded rules as any AI-run corp. You stay the owner and can resume control immediately. After this owner-initiated handoff, a cooldown of three real days applies before you can hand it back to a caretaker."}
        </p>
        {isCaretakerRun ? (
          <>
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
              Mandate
              <select
                aria-label="Caretaker mandate"
                value={mandate}
                disabled={busy}
                onChange={(event) => void setMandate(event.target.value as "active" | "passive")}
                className="h-7 rounded-md border border-card-border bg-background px-1.5 text-xs text-foreground focus:border-foreground focus:outline-none"
              >
                <option value="active">Active: pursue guarded profitable opportunities</option>
                <option value="passive">Passive: make no new discretionary commitments</option>
              </select>
            </label>
            <p className="text-[11px] text-muted">
              Passive stops new plants, capacity, technology, marketing, logistics, R&amp;D,
              dividends, and bond investments. Existing debt and operating costs still settle.
            </p>
            <SmallButton tone="primary" onClick={dismiss} disabled={busy}>
              {busy ? "Updating" : "Resume control"}
            </SmallButton>
          </>
        ) : (
          <SmallButton tone="primary" onClick={appoint} disabled={busy || onCooldown}>
            {busy ? "Appointing" : "Hand to NPP caretaker"}
          </SmallButton>
        )}
        <InlineStatus message={error} tone="error" />
        <InlineStatus message={success} tone="success" />
      </div>
    </GovernanceRow>
  );
}
