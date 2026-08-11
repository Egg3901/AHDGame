"use client";

import { US_STATE_ID_NAME_PAIRS } from "@/lib/constants/usStateNames";
import { formatPartyCountryMoney } from "@/lib/utils/formatters";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import type { NationalPosition } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Party money in the country's home currency (not always USD). */
export function fmt(n: number, countryId: string): string {
  return formatPartyCountryMoney(n, countryId);
}

export const US_STATES: [string, string][] = US_STATE_ID_NAME_PAIRS;

export const POSITIONS: NationalPosition[] = ["chair", "viceChair", "treasurer"];

/** Default (English) labels — kept for country-agnostic callers. */
export const POSITION_LABELS: Record<NationalPosition, string> = {
  chair: "National Chair",
  viceChair: "National Vice Chair",
  treasurer: "National Treasurer",
};

/** Country-aware label map for the three national positions. */
export function getPositionLabels(countryId: string): Record<NationalPosition, string> {
  return {
    chair: getPartyRoleLabel(countryId, "chair"),
    viceChair: getPartyRoleLabel(countryId, "viceChair"),
    treasurer: getPartyRoleLabel(countryId, "treasurer"),
  };
}
export const POSITION_DESC: Record<NationalPosition, string> = {
  chair: "Leads the national party. Sets national tax rates and manages state party relations.",
  viceChair: "Assists the chair. Can use national NPP influence alongside the chair.",
  treasurer:
    "Manages the national party treasury. Can distribute funds to state parties and members.",
};

// ─── Tooltip Component ────────────────────────────────────────────────────────

export function Tooltip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex ml-1.5 align-middle">
      <span className="h-3.5 w-3.5 rounded-full border border-card-border text-[8px] text-muted inline-flex items-center justify-center cursor-help select-none leading-none">
        ?
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-[10px] text-muted leading-snug opacity-0 transition-opacity group-hover/tip:opacity-100 z-20 shadow-lg whitespace-normal">
        {text}
      </span>
    </span>
  );
}
