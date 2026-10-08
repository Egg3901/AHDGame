/**
 * County results for the presidential map's state panel. The API is the same
 * subdivision-results route the state page uses; this module only reshapes its
 * response into table rows and map fills, and sorts them.
 */

import { classifyMarginTier, type MarginTier } from "@/lib/elections/generalViewModel";
import { shadeColorForTier } from "@/lib/elections/marginTierShade";
import { BLEND } from "@/components/blend/tokens";

/** The slice of the subdivision-results response the panel reads. */
export interface CountyApiResponse {
  viewBox: string;
  subdivisions: {
    id: string;
    name: string;
    path: string;
    votes?: Record<string, number>;
    margin: number;
    winner: string;
  }[];
}

export interface CountyRow {
  id: string;
  name: string;
  path: string;
  winnerId: string;
  winnerName: string;
  winnerColor: string;
  /** Winner share minus runner-up share, percentage points. */
  margin: number;
  tier: MarginTier;
  fill: string;
  votes: number;
}

export type CountySortKey = "name" | "leader" | "margin" | "votes";
export type SortDir = "asc" | "desc";

const NEUTRAL_FILL = "#1f1f2c";

export function buildCountyRows(
  data: CountyApiResponse,
  candidate: (id: string) => { name: string; color: string }
): CountyRow[] {
  return data.subdivisions.map((sub) => {
    const tier = classifyMarginTier(sub.margin);
    const winner = sub.winner ? candidate(sub.winner) : null;
    return {
      id: sub.id,
      name: sub.name,
      path: sub.path,
      winnerId: sub.winner,
      winnerName: winner?.name ?? "",
      winnerColor: winner?.color ?? NEUTRAL_FILL,
      margin: sub.margin,
      tier,
      fill: winner ? shadeColorForTier(winner.color, tier, BLEND.page) : NEUTRAL_FILL,
      votes: Object.values(sub.votes ?? {}).reduce((s, v) => s + v, 0),
    };
  });
}

/** Default direction when a header is first chosen: text ascending, figures descending. */
export function defaultSortDir(key: CountySortKey): SortDir {
  return key === "name" || key === "leader" ? "asc" : "desc";
}

export function sortCountyRows(rows: CountyRow[], key: CountySortKey, dir: SortDir): CountyRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const text = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (key === "name") cmp = text(a.name, b.name);
    else if (key === "leader") cmp = text(a.winnerName, b.winnerName) || a.margin - b.margin;
    else if (key === "margin") cmp = a.margin - b.margin;
    else cmp = a.votes - b.votes;
    // Ties fall back to the name so the order is stable between sorts.
    return cmp * sign || text(a.name, b.name);
  });
}
