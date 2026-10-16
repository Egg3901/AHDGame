"use client";

import { useState } from "react";
import { AUTOPILOT_ADVISORY_COPY } from "@/lib/corporations/autopilot";
import {
  AUTOPILOT_CAPEX_CASH_SHARE,
  AUTOPILOT_GROWTH_STEP_OF_RUN,
} from "@/lib/turn/npp/rules/autopilotReinvest";
import type { CorpTabId, CorporationDetail } from "./CorporationPageTypes";
import { DenseSection, InlineStatus, SmallButton } from "./dense/DenseKit";

const CAPEX_PERCENT = Math.round(AUTOPILOT_CAPEX_CASH_SHARE * 100);
const STEP_PERCENT = Math.round(AUTOPILOT_GROWTH_STEP_OF_RUN * 100);

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
  const [confirming, setConfirming] = useState(false);

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
      setConfirming(false);
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
        confirming && !on ? undefined : (
          <SmallButton
            tone={on ? "default" : "primary"}
            onClick={on ? toggle : () => setConfirming(true)}
            disabled={busy}
          >
            {busy ? "Saving" : on ? "Turn off" : "Turn on"}
          </SmallButton>
        )
      }
    >
      <div className="space-y-2 py-1">
        <p className="text-xs text-muted">
          {on
            ? "Autopilot sets budgets and dividends each turn, grows plants that sell in small steps once the extra capacity should pay for itself, pauses plants in a glut, and opens new plants when it has cash to spare. Budgets and dividends you change by hand are reset on the next turn while it is on. Everything else still works as normal."
            : "Let the corporation run itself. Autopilot sets budgets and dividends, grows plants that sell, and opens new plants when it has cash to spare. It plays safe: it never borrows, picks research, retools, sells or closes plants, or buys rivals, and it tells you here when one of those is worth doing. You stay CEO, but a top-10 corporation on autopilot earns the standard CEO influence, not the major tier."}
        </p>
        {!on && confirming && (
          <div className="space-y-2 border-y border-card-border py-2">
            <p className="text-sm font-medium">Before you turn autopilot on</p>
            <p className="text-xs text-muted">
              Autopilot may spend part of the corporation&apos;s cash on new plants. It does this
              gradually: each turn it commits at most {CAPEX_PERCENT}% of the cash above the
              reserve, and adds at most {STEP_PERCENT}% to any one plant, only where the plant is
              already making money and the new capacity should pay for itself. New plants take many
              turns to come online, and that cash is not available while they build.
            </p>
            <div className="flex gap-2">
              <SmallButton tone="primary" onClick={toggle} disabled={busy}>
                {busy ? "Saving" : "Turn on autopilot"}
              </SmallButton>
              <SmallButton onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </SmallButton>
            </div>
          </div>
        )}
        {on && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-card-border py-2">
            <p className="min-w-0 flex-1 text-xs text-muted">
              Autopilot may spend up to {CAPEX_PERCENT}% of the cash above the reserve on new plants
              each turn, at most {STEP_PERCENT}% of a plant&apos;s capacity at a time, and only
              where they should pay off. Builds take many turns to come online.
            </p>
            <SmallButton onClick={toggle} disabled={busy}>
              Turn off autopilot
            </SmallButton>
          </div>
        )}
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
