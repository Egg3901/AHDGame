// Shared helper functions (formatters, label functions, flavor text) for the State Party page.

import { formatPartyCountryMoney } from "@/lib/utils/formatters";
import type { Position } from "./types";

// ─── Formatters ───────────────────────────────────────────────────────────────

/** Party money in the country's home currency (not always USD). */
export function fmt(n: number, countryId: string): string {
  return formatPartyCountryMoney(n, countryId);
}

// ─── Organization ─────────────────────────────────────────────────────────────

export function getOrgLabel(org: number): { label: string; color: string } {
  if (org >= 80) return { label: "Dominant", color: "text-success" };
  if (org >= 60) return { label: "Strong", color: "text-success" };
  if (org >= 40) return { label: "Competitive", color: "text-warning" };
  if (org >= 20) return { label: "Developing", color: "text-warning" };
  if (org > 0) return { label: "Minimal", color: "text-error" };
  return { label: "None", color: "text-muted" };
}

export function getOrgBarColor(org: number): string {
  if (org >= 80) return "bg-success";
  if (org >= 60) return "bg-success";
  if (org >= 40) return "bg-warning";
  if (org >= 20) return "bg-warning";
  return "bg-error";
}

export function getOrgFlavorText(org: number, partyName: string): string {
  if (org >= 80)
    return `${partyName} dominates the political landscape here. Precinct captains, phone banks, and canvassers blanket every district.`;
  if (org >= 60)
    return `${partyName} has a well-oiled machine — established networks, reliable volunteers, and strong institutional presence.`;
  if (org >= 40)
    return `${partyName} holds a competitive operation with solid ground-level infrastructure and growing voter contact programs.`;
  if (org >= 20)
    return `${partyName} is building its grassroots presence. Local offices are staffed but the organization needs more investment.`;
  if (org > 0)
    return `${partyName} has only a skeleton crew here — a handful of dedicated activists keeping the party flag flying.`;
  return `${partyName} has no meaningful organization in this state. Everything must be built from scratch.`;
}

// ─── Treasury ─────────────────────────────────────────────────────────────────

export function getTreasuryFlavorText(treasury: number, netIncome: number): string {
  if (treasury > 100000 && netIncome > 0)
    return "War chest is overflowing. The party can fund aggressive campaigns and operations statewide.";
  if (treasury > 50000 && netIncome > 0)
    return "Healthy reserves with positive cash flow. Well-positioned for upcoming races.";
  if (treasury > 10000 && netIncome > 0)
    return "Modest but growing treasury. Enough for targeted operations but major campaigns will need more.";
  if (netIncome < 0)
    return "Spending exceeds revenue — the treasury is being drawn down each turn. Consider adjusting budgets.";
  if (treasury < 5000)
    return "Running on fumes. The party barely has enough to keep the lights on.";
  return "Adequate reserves for day-to-day operations. Strategic spending should be carefully considered.";
}

// ─── Leadership ────────────────────────────────────────────────────────────────

export const APPOINT_LABELS: Record<Position, string> = {
  chair: "State Chair",
  viceChair: "Vice Chair",
  treasurer: "Treasurer",
};
