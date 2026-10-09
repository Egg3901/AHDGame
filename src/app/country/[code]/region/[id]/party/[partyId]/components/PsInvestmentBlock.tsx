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
 * expected PS per turn and a clamp warning if the budget exceeds the
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
      <div className="flex items-center gap-2 mb-1">
        <svg
          className="h-4 w-4 text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <div className="text-body-sm font-medium text-muted">
          Political Strength (PS) budget per turn
        </div>
      </div>
      <p className="mb-3 text-xs text-muted leading-snug">
        PS is what the party spends to build Organization in states (the Build Organization buttons
        on each state page) and to campaign for its candidates. The party gets{" "}
        <span className="font-semibold">{flatPassivePerTurn} PS</span> free every turn. Set a budget
        here to buy more from the treasury.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          inputMode="decimal"
          aria-label="Political Strength budget per turn"
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
          <span className="text-muted">Buys: </span>
          <span className={`font-bold ${overCap ? "text-error" : "text-success"}`}>
            +{explicitPsPerTurn.toFixed(2)} PS per turn
          </span>
        </div>
      </div>
      <div className="mt-2 rounded-md border border-card-border/40 bg-background/30 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-muted text-body-sm font-medium">PS gained per turn</span>
          <span className="tabular-nums font-bold text-success">
            +{totalPsPerTurn.toFixed(2)} PS
          </span>
        </div>
        <div className="mt-1 text-[11px] text-muted leading-relaxed">
          <span className="font-semibold">{flatPassivePerTurn}</span> free +{" "}
          <span className="font-semibold">{explicitPsPerTurn.toFixed(2)}</span> bought with your
          budget
        </div>
      </div>
      <div className="mt-2 text-xs text-muted leading-snug">
        Every <span className="font-semibold">{fmt(psInvestmentRateDisplay, countryId)}</span> of
        budget buys 1 PS, up to{" "}
        <span className="font-semibold">{PS_INVESTMENT_MAX_TIERS} PS per turn</span>. The money
        comes out of the party treasury each turn. Once the party&apos;s PS reserve is full, nothing
        more is bought or charged.
      </div>
      {overCap && (
        <div className="mt-1 text-xs text-error">
          Budget is over the {fmt(psInvestmentMaxDisplay, countryId)} limit, which already buys the
          maximum of {PS_INVESTMENT_MAX_TIERS} PS per turn.
        </div>
      )}
      <div className="mt-1 text-xs text-muted">Party treasury: {fmt(treasury, countryId)}</div>
    </div>
  );
}
