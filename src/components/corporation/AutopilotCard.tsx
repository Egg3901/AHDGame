"use client";

import { useState } from "react";
import { AUTOPILOT_ADVISORY_COPY } from "@/lib/corporations/autopilot";
import type { CorpTabId, CorporationDetail } from "./CorporationPageTypes";
import { DenseSection, InlineStatus, SmallButton } from "./dense/DenseKit";

/**
 * Owner switch for autopilot, and the moves autopilot recommends but leaves to
 * the owner. Rendered for the sitting CEO only; hidden while a caretaker runs
 * the corporation, since the caretaker already makes every decision.
 */
export function AutopilotCard({
  corporation,
  corpId,
  onTabChange,
  onRefresh,
}: {
  corporation: CorporationDetail;
  corpId: string;
  onTabChange: (tab: CorpTabId) => void;
  onRefresh?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (corporation.ceoVacant || !corporation.ceoCharacterId) return null;
  if (corporation.countryOwnerId || corporation.isNationalized) return null;

  const autopilot = corporation.autopilot ?? null;
  const on = autopilot != null;

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/autopilot`, {
        method: on ? "DELETE" : "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not change autopilot");
      onRefresh?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DenseSection
      id="autopilot"
      title="Autopilot"
      meta={on ? "On" : "Off"}
      actions={
        <SmallButton tone={on ? "default" : "primary"} onClick={toggle} disabled={busy}>
          {busy ? "Saving" : on ? "Turn off" : "Turn on"}
        </SmallButton>
      }
    >
      <div className="space-y-2 py-1">
        <p className="text-xs text-muted">
          {on
            ? "Autopilot sets budgets and dividends each turn, grows plants that sell, and closes deep losers. Budgets and dividends you change by hand are reset on the next turn while it is on. Everything else still works as normal."
            : "Let the corporation run itself. Autopilot sets budgets and dividends, grows plants that sell, and closes deep losers. It plays safe: it never borrows, picks research, retools plants or buys rivals, and it tells you here when one of those is worth doing. You stay CEO."}
        </p>
        {on && autopilot.advisories.length === 0 && (
          <p className="text-xs text-muted">Nothing needs you right now.</p>
        )}
        {on && autopilot.advisories.length > 0 && (
          <ul className="divide-y divide-card-border border-y border-card-border">
            {autopilot.advisories.map((advisory) => {
              const copy = AUTOPILOT_ADVISORY_COPY[advisory.kind];
              const turns = Math.max(0, corporation.currentTurn - advisory.sinceTurn);
              return (
                <li key={advisory.kind} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-warning">{copy.title}</p>
                    <p className="text-xs text-muted">{copy.body(advisory.subject)}</p>
                    {turns > 0 && (
                      <p className="text-[11px] text-muted">
                        For {turns} {turns === 1 ? "hour" : "hours"}
                      </p>
                    )}
                  </div>
                  <SmallButton onClick={() => onTabChange(copy.tab)}>{copy.action}</SmallButton>
                </li>
              );
            })}
          </ul>
        )}
        <InlineStatus message={error} tone="error" />
      </div>
    </DenseSection>
  );
}
