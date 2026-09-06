import type { InfluenceType } from "@/lib/db/types";
import type { NPPStats } from "./types";

export interface RosterNpp {
  id: string;
  sequentialId?: number | null;
  name: string;
  homeState: string;
  stats: NPPStats;
  estimatedChance: number;
  currentOfficeLabel?: string | null;
  activeCandidacyLabel?: string | null;
}

export const ATTENTION_LOYALTY = 35;
export const ATTENTION_FAV = 35;
export const ATTENTION_STUBBORN = 70;

/** Triage flags for an NPP based on its stats. Empty when nothing needs attention. */
export function needsAttention(s: NPPStats): string[] {
  const flags: string[] = [];
  if (s.loyalty < ATTENTION_LOYALTY) flags.push("Low loyalty");
  if (s.favorability < ATTENTION_FAV) flags.push("Low favorability");
  if (s.stubbornness > ATTENTION_STUBBORN) flags.push("High stubbornness");
  return flags;
}

/** The single action the UI highlights as "Recommended" for this NPP. */
export function recommendedAction(s: NPPStats): InfluenceType {
  if (s.loyalty < ATTENTION_LOYALTY) return "boost_loyalty";
  if (s.favorability < ATTENTION_FAV) return "boost_favorability";
  if (s.stubbornness > ATTENTION_STUBBORN) return "reduce_stubbornness";
  return "boost_influence";
}

export type RosterFilter =
  "all" | "attention" | "low_loyalty" | "low_fav" | "stubborn" | "running" | "no_office";

export function filterRoster(
  rows: RosterNpp[],
  opts: { filter: RosterFilter; state: string; q: string }
): RosterNpp[] {
  const q = opts.q.trim().toLowerCase();
  return rows.filter((n) => {
    if (opts.state !== "all" && n.homeState !== opts.state) return false;
    if (q && !n.name.toLowerCase().includes(q) && !n.homeState.toLowerCase().includes(q))
      return false;
    switch (opts.filter) {
      case "attention":
        return needsAttention(n.stats).length > 0;
      case "low_loyalty":
        return n.stats.loyalty < ATTENTION_LOYALTY;
      case "low_fav":
        return n.stats.favorability < ATTENTION_FAV;
      case "stubborn":
        return n.stats.stubbornness > ATTENTION_STUBBORN;
      case "running":
        return !!n.activeCandidacyLabel;
      case "no_office":
        return !n.currentOfficeLabel && !n.activeCandidacyLabel;
      default:
        return true;
    }
  });
}

export type RosterSort =
  | "attention"
  | "name"
  | "state"
  | "favorability"
  | "politicalInfluence"
  | "loyalty"
  | "ambition"
  | "stubbornness";

export function sortRoster(rows: RosterNpp[], key: RosterSort): RosterNpp[] {
  const out = [...rows];
  out.sort((a, b) => {
    if (key === "attention")
      return (
        needsAttention(b.stats).length - needsAttention(a.stats).length ||
        a.stats.loyalty - b.stats.loyalty
      );
    if (key === "name") return a.name.localeCompare(b.name);
    if (key === "state") return a.homeState.localeCompare(b.homeState);
    if (key === "stubbornness") return b.stats.stubbornness - a.stats.stubbornness; // worst (high) first
    return b.stats[key] - a.stats[key];
  });
  return out;
}

/** Aggregate action + fund cost of applying an action to `count` NPPs. */
export function bulkCost(count: number, action: { actionCost: number; baseFundCost: number }) {
  return { actions: count * action.actionCost, funds: count * action.baseFundCost };
}
