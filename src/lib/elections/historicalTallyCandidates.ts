import type { EnrichedCandidate } from "./candidateEnrichment";

/**
 * Restores candidates who contested a finished election but whose
 * `electionCandidates` record was deleted afterwards.
 *
 * A finished election is a historical record and must render the same field
 * forever. The turn-651 Liberal/SDP merge deleted every Liberal NPP, taking
 * their candidacy rows with them, and the results page silently dropped them:
 * Scotland's count fell from 2,498,473 votes to 2,177,563 and every share was
 * recomputed on the smaller denominator, while the seats those candidates had
 * won were left unaccounted for. Players read that as the results changing.
 *
 * The tally still holds their name, party and votes, which is everything a
 * results row needs. Restored rows carry `characterId: null` — there is no
 * profile left to link to — and neutral zeroes for the live-standing fields
 * (favorability, influence, endorsements), none of which a settled result uses.
 *
 * Callers gate this on the race being over. While a race is live, a missing
 * candidacy means the candidate genuinely withdrew and should not be shown.
 */

/** The tally fields a historical row can be rebuilt from. */
export interface HistoricalTallySource {
  totalVotes?: Record<string, number>;
  candidateNames?: Record<string, string>;
  candidateParties?: Record<string, string>;
}

/** Party display attributes, resolved by the caller from its party map. */
export interface HistoricalPartyInfo {
  name: string;
  color: string;
  econ: number;
  social: number;
}

export function appendHistoricalTallyCandidates(
  displayCandidates: EnrichedCandidate[],
  tally: HistoricalTallySource | null | undefined,
  partyInfo: (partyId: string) => HistoricalPartyInfo
): EnrichedCandidate[] {
  const votes = tally?.totalVotes;
  if (!votes) return displayCandidates;

  const present = new Set(displayCandidates.map((c) => c.id));
  // A restored row has no `characterId`, so it slips past the caller's
  // same-character de-duplication. Guard on the name instead: a character with
  // two candidacies (the partial unique index allows it once one is withdrawn)
  // would otherwise appear twice on the results page if only one candidacy doc
  // was deleted. Two genuinely different people sharing a name is the cost, and
  // is the better failure: a missing row reads as data loss, a doubled one
  // reads as a bug.
  const shown = new Set(displayCandidates.map((c) => c.characterName));
  const restored: EnrichedCandidate[] = [];
  // Historical share, measured against the whole count as published. Left at
  // zero these rows would render "0.0%" on any surface reading `sharePct`,
  // which is the opposite of preserving the record.
  const castTotal = Object.values(votes).reduce((sum, v) => sum + (v ?? 0), 0);

  for (const [candidateId, voteCount] of Object.entries(votes)) {
    if (present.has(candidateId)) continue;
    // A deleted candidate with no votes never appeared on a results page and
    // adds nothing to the record.
    if (!(voteCount > 0)) continue;

    // Dedupe on REAL names only. Two nameless rows would both fall back to the
    // placeholder and the second would be dropped, taking its votes out of the
    // denominator — the very hole this function exists to close.
    const knownName = tally?.candidateNames?.[candidateId];
    if (knownName) {
      if (shown.has(knownName)) continue;
      shown.add(knownName);
    }
    const characterName = knownName ?? "Former candidate";

    // "independent" rather than "" for a party the tally never recorded: the
    // results route defaults tally-only candidates the same way, and an empty
    // id renders as a blank abbreviation instead of a readable label.
    const partyId = tally?.candidateParties?.[candidateId] || "independent";
    const info = partyInfo(partyId);
    restored.push({
      id: candidateId,
      characterId: null,
      characterName,
      party: partyId,
      partyName: info.name,
      partyColor: info.color,
      partyEcon: info.econ,
      partySocial: info.social,
      isNPP: false,
      nppId: null,
      economicPosition: info.econ,
      socialPosition: info.social,
      favorability: 0,
      politicalInfluence: 0,
      nationalInfluence: 0,
      primaryScore: 0,
      sharePct: castTotal > 0 ? (voteCount / castTotal) * 100 : 0,
      enteredAt: new Date(0),
      endorsements: [],
      isYou: false,
    });
  }

  return restored.length > 0 ? [...displayCandidates, ...restored] : displayCandidates;
}
