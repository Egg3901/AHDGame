/**
 * Summary-view read projections for the election resolver (#2168).
 *
 * List views (country elections page, GET /api/elections?view=summary) render
 * candidate summary cards from `EnrichedCandidate`, which needs a fixed set
 * of display and scoring inputs. Fetching whole documents here deserializes
 * ~31KB of NPP `policies.domainPositions` per candidate (~1.5MB for a
 * 50-candidate country page) that no summary consumer reads.
 *
 * Field audit (every reader of the projected docs in summary mode):
 * - NPP: `candidateEnrichment` reads name, party, policies.economic/social,
 *   favorability, politicalInfluence, homeState, avatarUrl, sequentialId;
 *   batch incumbent matching reads name, party, countryId, currentOffice;
 *   `ownerPositionById` in _enrichElection reads policies.economic/social.
 *   Nothing reads `policies.domainPositions`, so the projection excludes
 *   exactly that subtree and keeps everything else (future-proof).
 * - Character: `candidateEnrichment` reads party, policies.economic/social,
 *   favorability, politicalInfluence, nationalInfluence, partyInfluence,
 *   infamy, homeState, avatarUrl, sequentialId, name (running mate),
 *   currentOffice is matched for incumbents; `applyStandingAds` reads
 *   targetedAds; _enrichElection maps _id/party. Inclusion list below is
 *   that closed set. ADD new fields here (not a wider fetch) when summary
 *   enrichment starts reading more.
 * - GameState: summary enrichment reads preset + currentYear
 *   (`loadApportionment`, majoritarian bonus) and redistrictingEnabled (US
 *   House districted projection). The `gameState` response block is null in
 *   summary mode, so nothing else is consumed.
 *
 * Full view keeps whole documents: detail pages and the turn-adjacent
 * overlays read beyond this set.
 */
import type { Document } from "mongodb";

/** Excludes the ~30KB stance map; every other NPP field still loads. */
export const ELECTION_SUMMARY_NPP_PROJECTION: Document = {
  "policies.domainPositions": 0,
};

/** Closed inclusion set from the audit above. */
export const ELECTION_SUMMARY_CHARACTER_PROJECTION: Document = {
  name: 1,
  party: 1,
  countryId: 1,
  homeState: 1,
  avatarUrl: 1,
  sequentialId: 1,
  currentOffice: 1,
  favorability: 1,
  politicalInfluence: 1,
  nationalInfluence: 1,
  partyInfluence: 1,
  infamy: 1,
  targetedAds: 1,
  "policies.economic": 1,
  "policies.social": 1,
};

/** Everything summary enrichment reads off gameState. */
export const ELECTION_SUMMARY_GAME_STATE_PROJECTION: Document = {
  preset: 1,
  currentYear: 1,
  redistrictingEnabled: 1,
};
