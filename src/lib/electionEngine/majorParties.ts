/**
 * Major-party resolution for FPTP spoiler modelling (#811).
 *
 * `getMajorPartiesForRegion` returns seed slugs and abbreviations, but live
 * candidates store `party` as the party's sequentialId string, so for the UK
 * and Japan the slug set matched nothing, `majorParties` came back empty and
 * the whole spoiler pass (and the poll mirror of it) was silently skipped.
 *
 * Resolution order per candidate: `party` in the set, then `partyAbbr` in the
 * set. If that yields fewer than two major parties while the race has three or
 * more parties, the two parties carrying the most weight (nominal votes or
 * poll pool) are treated as major. A two-party race has no third party to
 * spoil, so it returns everything as major and the caller's guard skips.
 */
export interface MajorPartyCandidateLike {
  party: string;
  partyAbbr?: string;
}

export function isMajorPartyCandidate(
  c: MajorPartyCandidateLike,
  majorSet: ReadonlySet<string>
): boolean {
  if (majorSet.has(c.party)) return true;
  return typeof c.partyAbbr === "string" && majorSet.has(c.partyAbbr);
}

export function partitionMajorParties<T extends MajorPartyCandidateLike>(
  candidates: readonly T[],
  majorSet: ReadonlySet<string>,
  weightOf: (c: T) => number
): { major: T[]; third: T[]; resolvedBy: "config" | "weight" | "none" } {
  const major = candidates.filter((c) => isMajorPartyCandidate(c, majorSet));
  const majorPartyCount = new Set(major.map((c) => c.party)).size;
  if (majorPartyCount >= 2 || majorPartyCount === candidates.length) {
    return {
      major,
      third: candidates.filter((c) => !isMajorPartyCandidate(c, majorSet)),
      resolvedBy: "config",
    };
  }
  const partyIds = [...new Set(candidates.map((c) => c.party))];
  // The weight fallback is for LIVE races, where the enrichment pass stamped
  // `partyAbbr` and the config encoding simply did not match the roster (a
  // 1953 Japan has no LDP). Hand-built fixtures carry no abbreviation and keep
  // the legacy behaviour: no config match, no spoiler.
  const isLiveRace = candidates.some((c) => typeof c.partyAbbr === "string");
  if (partyIds.length < 3 || !isLiveRace) {
    return { major: [...candidates], third: [], resolvedBy: "none" };
  }
  const weightByParty = new Map<string, number>();
  for (const c of candidates) {
    const w = weightOf(c);
    weightByParty.set(c.party, (weightByParty.get(c.party) ?? 0) + (Number.isFinite(w) ? w : 0));
  }
  const top = partyIds
    .sort((a, b) => (weightByParty.get(b) ?? 0) - (weightByParty.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, 2);
  const topSet = new Set(top);
  return {
    major: candidates.filter((c) => topSet.has(c.party)),
    third: candidates.filter((c) => !topSet.has(c.party)),
    resolvedBy: "weight",
  };
}
