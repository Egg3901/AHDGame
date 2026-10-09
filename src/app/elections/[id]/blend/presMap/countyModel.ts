/**
 * County results for the presidential map's state panel. The API is the same
 * subdivision-results route the state page uses; this module only reshapes its
 * response into table rows and map fills, and sorts them.
 */

import { classifyMarginTier, type MarginTier } from "@/lib/elections/generalViewModel";
import { shadeColorForTier } from "@/lib/elections/marginTierShade";
import { BLEND, BLEND_HEX } from "@/components/blend/tokens";

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
  /** The tally's own candidate names and parties, keyed by the ids above. */
  candidateNames?: Record<string, string>;
  candidateParties?: Record<string, string>;
  partyColors?: Record<string, string>;
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
  /**
   * Share of the county's vote, 0..100, keyed by candidate name. Keyed by
   * name rather than id because the tally behind this route and the election
   * payload can key the same ticket differently.
   */
  shareByName: Record<string, number>;
}

export type CountySortKey = "name" | "leader" | "margin" | "votes";
export type SortDir = "asc" | "desc";

const NEUTRAL_FILL = "#1f1f2c";

/**
 * The caller's lookup knows the race's candidates by the ids the election
 * payload uses; the tally behind the county route can key them differently.
 * Where the caller's lookup does not know an id, the route's own names and
 * party colours stand in, so a county never renders as an unnamed grey.
 */
function resolveCandidate(
  data: CountyApiResponse,
  candidate: (id: string) => { name: string; color: string } | undefined,
  id: string
): { name: string; color: string } | null {
  const known = candidate(id);
  if (known && known.name !== "Unknown") return known;
  const name = data.candidateNames?.[id];
  const party = data.candidateParties?.[id];
  const color = party ? data.partyColors?.[party] : undefined;
  if (name || color)
    return { name: name ?? known?.name ?? "Unknown", color: color ?? known?.color ?? NEUTRAL_FILL };
  return known ?? null;
}

function shareByName(
  data: CountyApiResponse,
  candidate: (id: string) => { name: string; color: string } | undefined,
  votes: Record<string, number>
): Record<string, number> {
  const total = Object.values(votes).reduce((s, v) => s + v, 0);
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const [id, v] of Object.entries(votes)) {
    const name = resolveCandidate(data, candidate, id)?.name;
    if (name) out[name] = (out[name] ?? 0) + (v / total) * 100;
  }
  return out;
}

export function buildCountyRows(
  data: CountyApiResponse,
  candidate: (id: string) => { name: string; color: string } | undefined,
  /** Page ground the tier shades fade toward; the theme's, as hex. */
  ground: string = BLEND_HEX.page
): CountyRow[] {
  return data.subdivisions.map((sub) => {
    const tier = classifyMarginTier(sub.margin);
    const winner = sub.winner ? resolveCandidate(data, candidate, sub.winner) : null;
    return {
      id: sub.id,
      name: sub.name,
      path: sub.path,
      winnerId: sub.winner,
      winnerName: winner?.name ?? "",
      winnerColor: winner?.color ?? NEUTRAL_FILL,
      margin: sub.margin,
      tier,
      fill: winner ? shadeColorForTier(winner.color, tier, ground) : BLEND.trackAlt,
      votes: Object.values(sub.votes ?? {}).reduce((s, v) => s + v, 0),
      shareByName: shareByName(data, candidate, sub.votes ?? {}),
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
