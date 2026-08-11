"use client";

import { Input } from "@/components/ui";
import { parseMoneyAmountInput } from "@/lib/utils/parseMoneyAmountInput";
import { fmt } from "./helpers";
import { PS_INVESTMENT_MAX_TIERS } from "@/lib/politicalStrength/strengthConstants";

interface PsInvestmentBlockProps {
  partyColor: string;
  psInvestmentBudget: string;
  setPsInvestmentBudget: (v: string) => void;
  savingPsInvestment: boolean;
  handleSavePsInvestment: () => void;
  /** Per-+1 PS investment cost in the party's local currency (explicit lever rate). */
  psInvestmentRateDisplay: number;
  /** Maximum acceptable budget in the party's local currency. */
  psInvestmentMaxDisplay: number;
  /**
   * Flat passive PS this party earns every turn (national 20 / state 5),
   * treasury-independent. Shown so the chair sees total PS/turn (passive +
   * spend) at a glance.
   */
  flatPassivePerTurn: number;
  treasury: number;
  countryId: string;
}

/**
 * Chair-set per-turn PS investment budget input, with live-preview of
 * expected `+PS / turn` and a clamp warning if the budget exceeds the
 * `PS_INVESTMENT_MAX_TIERS` cap. Used on both the State Treasurer tab and
 * the National Party Hub.
 *
 * The input is the party's local home currency; the parent POSTs it to
 * `/ps-investment` as-is (no FX conversion, post-Phase-6). Spend converts at
 * the full rate up to the hard cap (soft-cap bands removed 2026-06-28); near
 * the cap the turn engine only buys — and only charges for — the PS that fits
 * below the cap.
 */
export function PsInvestmentBlock({
  partyColor,
  psInvestmentBudget,
  setPsInvestmentBudget,
  savingPsInvestment,
  handleSavePsInvestment,
  psInvestmentRateDisplay,
  psInvestmentMaxDisplay,
  flatPassivePerTurn,
  treasury,
  countryId,
}: PsInvestmentBlockProps) {
  // Best-effort parse of the input for live preview.
  const parsedBudget = Math.max(0, parseMoneyAmountInput(psInvestmentBudget));
  const explicitPsPerTurn = Math.min(
    PS_INVESTMENT_MAX_TIERS,
    psInvestmentRateDisplay > 0 ? parsedBudget / psInvestmentRateDisplay : 0
  );
  // Flat passive is always paid (treasury-independent); spend stacks on top.
  const totalPsPerTurn = flatPassivePerTurn + explicitPsPerTurn;
  const overCap = parsedBudget > psInvestmentMaxDisplay;

  return (
    <div className="px-6 py-5 border-b border-card-border/40">
      <div className="flex items-center gap-2 mb-3">
        <svg
          className="h-4 w-4 text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          PS Investment / turn
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          inputMode="decimal"
          placeholder={`Up to ${fmt(psInvestmentMaxDisplay, countryId)}`}
          value={psInvestmentBudget}
          onChange={(e) => setPsInvestmentBudget(e.target.value)}
          className="w-44 bg-background py-2 text-sm tabular-nums"
        />
        <button
          onClick={handleSavePsInvestment}
          disabled={savingPsInvestment || overCap}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: partyColor }}
        >
          {savingPsInvestment ? "Saving…" : "Save"}
        </button>
        <div className="text-xs tabular-nums">
          <span className="text-muted">From spend: </span>
          <span className={`font-bold ${overCap ? "text-error" : "text-success"}`}>
            +{explicitPsPerTurn.toFixed(2)} PS / turn
          </span>
        </div>
      </div>
      <div className="mt-2 rounded-md border border-card-border/40 bg-background/30 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold text-muted uppercase tracking-wide text-[10px]">
            Total this turn
          </span>
          <span className="tabular-nums font-bold text-success">
            +{totalPsPerTurn.toFixed(2)} PS / turn
          </span>
        </div>
        <div className="mt-1 text-[11px] text-muted leading-relaxed">
          <span className="font-semibold">+{flatPassivePerTurn}</span> flat passive (every turn, no
          treasury needed) + <span className="font-semibold">+{explicitPsPerTurn.toFixed(2)}</span>{" "}
          from your spend below.
        </div>
      </div>
      <div className="mt-2 text-xs text-muted leading-snug">
        A flat <span className="font-semibold">+{flatPassivePerTurn} PS / turn</span> applies every
        turn regardless of treasury. Your <span className="font-semibold">spend</span> debits
        treasury and converts to PS at{" "}
        <span className="font-semibold">{fmt(psInvestmentRateDisplay, countryId)} / +1 PS</span>, up
        to <span className="font-semibold">+{PS_INVESTMENT_MAX_TIERS} PS / turn</span>. Growth is
        limited only by the hard cap — near it, spend buys (and is charged for) just the PS that
        fits below the cap.
      </div>
      {overCap && (
        <div className="mt-1 text-xs text-error">
          Budget exceeds the {fmt(psInvestmentMaxDisplay, countryId)} cap (max +
          {PS_INVESTMENT_MAX_TIERS} PS / turn).
        </div>
      )}
      <div className="mt-1 text-xs text-muted">Available: {fmt(treasury, countryId)}</div>
    </div>
  );
}
