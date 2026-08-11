/** Floor so a maximally-misaligned party still draws a sliver of match rather
 *  than exactly 0 (keeps the normalized split well-defined). */
const MATCH_FLOOR = 0.5;

export interface RegionPartyPosition {
  partyId: string;
  name: string;
  abbreviation: string;
  color: string;
  economicPosition: number;
  socialPosition: number;
}

export interface PartyMatch {
  partyId: string;
  name: string;
  abbreviation: string;
  color: string;
  matchPct: number;
}

/**
 * Per-archetype party match shares — a pure *ideological* match: the axis
 * distance between the group's lean and each party's platform, normalized to a
 * share across the supplied major parties.
 *
 * This deliberately does NOT use the election engine's `calcAppeal`: that model
 * adds a large "tribal" directional bonus (up to +30) that over-amplifies even
 * near-centrist groups into lopsided splits (e.g. a group at econ 0 / social
 * +0.5 reads as ~76% one party), which collapses the "persuadable / toss-up"
 * band to nothing. Straight platform distance keeps genuinely-central groups
 * near 50/50 so `classifyLean` can surface them as persuadable, and matches the
 * "ideological match" the UI advertises. Returns parties sorted by `matchPct`
 * descending; an empty party list yields `[]`.
 */
export function computeGroupPartyMatches(
  groupEconomicLean: number,
  groupSocialLean: number,
  parties: RegionPartyPosition[]
): PartyMatch[] {
  if (parties.length === 0) return [];
  const appeals = parties.map((p) => ({
    party: p,
    appeal: Math.max(
      MATCH_FLOOR,
      50 -
        (Math.abs(groupEconomicLean - p.economicPosition) +
          Math.abs(groupSocialLean - p.socialPosition)) *
          5
    ),
  }));
  const total = appeals.reduce((s, a) => s + a.appeal, 0) || 1;
  return appeals
    .map(({ party, appeal }) => ({
      partyId: party.partyId,
      name: party.name,
      abbreviation: party.abbreviation,
      color: party.color,
      matchPct: Math.round((appeal / total) * 100),
    }))
    .sort((a, b) => b.matchPct - a.matchPct);
}

export interface ArchetypeWeightInput {
  economicLean: number;
  socialLean: number;
  /** Positive weight (e.g. expected voters = population × turnout). */
  weight: number;
}

/**
 * Region-level projected vote split. Each archetype's per-party match fractions
 * (from `computeGroupPartyMatches`) are weighted by its `weight` (expected
 * voters) and averaged across the electorate, then normalized to 100 across the
 * supplied major parties. Pure derivation from the same ideological-match
 * model above — an alignment baseline, not an election simulation. Returns
 * parties sorted by projected share desc; empty party list yields `[]`.
 */
export function computeStateProjection(
  archetypes: ArchetypeWeightInput[],
  parties: RegionPartyPosition[]
): PartyMatch[] {
  if (parties.length === 0) return [];
  const meta = new Map<string, PartyMatch>();
  const acc = new Map<string, number>();
  let totalWeight = 0;
  for (const a of archetypes) {
    const w = a.weight > 0 ? a.weight : 0;
    if (w === 0) continue;
    totalWeight += w;
    for (const m of computeGroupPartyMatches(a.economicLean, a.socialLean, parties)) {
      acc.set(m.partyId, (acc.get(m.partyId) ?? 0) + (m.matchPct / 100) * w);
      if (!meta.has(m.partyId)) meta.set(m.partyId, m);
    }
  }
  const source =
    totalWeight > 0
      ? [...acc.entries()].map(([partyId, v]) => ({ partyId, val: v / totalWeight }))
      : parties.map((p) => ({ partyId: p.partyId, val: 1 / parties.length }));
  const sum = source.reduce((s, r) => s + r.val, 0) || 1;
  return source
    .map((r) => {
      const m =
        meta.get(r.partyId) ??
        (() => {
          const p = parties.find((x) => x.partyId === r.partyId)!;
          return {
            partyId: p.partyId,
            name: p.name,
            abbreviation: p.abbreviation,
            color: p.color,
            matchPct: 0,
          };
        })();
      return { ...m, matchPct: Math.round((r.val / sum) * 100) };
    })
    .sort((a, b) => b.matchPct - a.matchPct);
}

export interface LeanClassification {
  /** Preferred party id, or null when the group is a toss-up. */
  partyId: string | null;
  abbreviation: string;
  color: string;
  /** Display label: "Leans <ABBR>" or "Persuadable". */
  label: string;
  isTossUp: boolean;
}

/**
 * Classify a group's party lean from its match distribution. A group is
 * "persuadable" when its top two parties are within `tossupMargin` points
 * (ideologically up for grabs); otherwise it "leans" its top party. POV-free —
 * derived purely from the group's own ideological-match ranking.
 */
export function classifyLean(matches: PartyMatch[], tossupMargin = 12): LeanClassification {
  if (matches.length === 0) {
    return {
      partyId: null,
      abbreviation: "",
      color: "#94a3b8",
      label: "Unclassified",
      isTossUp: true,
    };
  }
  const top = matches[0];
  const second = matches[1];
  const isTossUp = second != null && top.matchPct - second.matchPct < tossupMargin;
  return {
    partyId: isTossUp ? null : top.partyId,
    abbreviation: top.abbreviation,
    color: isTossUp ? "#94a3b8" : top.color,
    label: isTossUp ? "Persuadable" : `Leans ${top.abbreviation}`,
    isTossUp,
  };
}
