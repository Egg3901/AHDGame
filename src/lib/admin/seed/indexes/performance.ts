import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

// Compound indexes on hot read paths — bills list, notifications, election lookups,
// primary snapshots, politician sorts, and the unread-mail counter hit on every auth/me.
export async function seedPerfIndexes(db: Db, log: (msg: string) => void) {
  log("Performance indexes:");

  // bills — list filters + sort
  await ensureIndex(
    db,
    "bills",
    { countryId: 1, status: 1, proposedAt: -1 },
    { name: "bills_countryId_status_proposedAt" },
    log
  );
  await ensureIndex(
    db,
    "bills",
    { countryId: 1, currentChamber: 1, status: 1, proposedAt: -1 },
    { name: "bills_countryId_chamber_status_proposedAt" },
    log
  );
  await ensureIndex(db, "bills", { proposedAt: -1 }, { name: "bills_proposedAt" }, log);

  // notifications — per-user list + unread counter
  await ensureIndex(
    db,
    "notifications",
    { userId: 1, createdAt: -1 },
    { name: "notifications_userId_createdAt" },
    log
  );
  await ensureIndex(
    db,
    "notifications",
    { userId: 1, read: 1 },
    { name: "notifications_userId_read" },
    log
  );

  // elections — batch lookups by electionId
  await ensureIndex(
    db,
    "electionCandidates",
    { electionId: 1 },
    { name: "electionCandidates_electionId" },
    log
  );
  // electionCandidates — a character's own candidacies (supportEvents.ts's
  // applySupportDelta). Found missing while auditing scalability toward a
  // 30-50-country sim; every call was a full collection scan.
  await ensureIndex(
    db,
    "electionCandidates",
    { characterId: 1 },
    { sparse: true, name: "electionCandidates_characterId" },
    log
  );
  await ensureIndex(
    db,
    "electionVoteTallies",
    { electionId: 1 },
    { name: "electionVoteTallies_electionId" },
    log
  );

  // electedOfficials — lookup a character's offices
  await ensureIndex(
    db,
    "electedOfficials",
    { characterId: 1, officeType: 1 },
    { name: "electedOfficials_characterId_officeType" },
    log
  );

  // nppEndorsements — endorsements per election
  await ensureIndex(
    db,
    "nppEndorsements",
    { electionId: 1, isActive: 1 },
    { name: "nppEndorsements_electionId_isActive" },
    log
  );

  // primarySnapshots — desc for latest/aggregation, asc for chronological history charts
  await ensureIndex(
    db,
    "primarySnapshots",
    { electionId: 1, recordedAt: -1 },
    { name: "primarySnapshots_electionId_recordedAt_desc" },
    log
  );
  await ensureIndex(
    db,
    "primarySnapshots",
    { electionId: 1, recordedAt: 1 },
    { name: "primarySnapshots_electionId_recordedAt_asc" },
    log
  );

  // npps — active NPP filter
  await ensureIndex(
    db,
    "npps",
    { retiredAt: 1, countryId: 1 },
    { name: "npps_retiredAt_countryId" },
    log
  );
  // npps — the main NPP action-processing loop's hot per-cycle query
  // (nppActionProcessing.ts: retiredAt:null + actionPoints:{$gte:1}).
  // retiredAt alone is low-selectivity (most NPPs are non-retired at any
  // point), so this compound was needed for the query to actually narrow
  // down instead of scanning most of the collection — found while auditing
  // scalability toward a 30-50-country sim (40-80K+ NPPs).
  await ensureIndex(
    db,
    "npps",
    { retiredAt: 1, actionPoints: 1 },
    { name: "npps_retiredAt_actionPoints" },
    log
  );

  // characters — politicians list sort
  await ensureIndex(
    db,
    "characters",
    { countryId: 1, politicalInfluence: -1 },
    { name: "characters_countryId_politicalInfluence" },
    log
  );
  // characters — party roster filtering (politician list, party member pages)
  await ensureIndex(
    db,
    "characters",
    { party: 1, countryId: 1 },
    { name: "characters_party_countryId" },
    log
  );
  // characters — office lookup for officials pages (sparse because most are null)
  await ensureIndex(
    db,
    "characters",
    { currentOffice: 1 },
    { name: "characters_currentOffice", sparse: true },
    log
  );

  // npps — party roster filtering
  await ensureIndex(db, "npps", { party: 1, countryId: 1 }, { name: "npps_party_countryId" }, log);
  // npps — state-based filtering (regional council, landtag lookups)
  await ensureIndex(
    db,
    "npps",
    { homeState: 1, countryId: 1 },
    { name: "npps_homeState_countryId" },
    log
  );

  // playerMail — unread mail count (hit on every auth/me)
  await ensureIndex(
    db,
    "playerMail",
    { toUserId: 1, read: 1, deletedByRecipient: 1 },
    { name: "playerMail_toUserId_read_deleted" },
    log
  );

  // politicalParties — leadership lookups (chair, viceChair, treasurer)
  await ensureIndex(
    db,
    "politicalParties",
    { chairId: 1 },
    { name: "politicalParties_chairId", sparse: true },
    log
  );
  await ensureIndex(
    db,
    "politicalParties",
    { viceChairId: 1 },
    { name: "politicalParties_viceChairId", sparse: true },
    log
  );
  await ensureIndex(
    db,
    "politicalParties",
    { treasurerId: 1 },
    { name: "politicalParties_treasurerId", sparse: true },
    log
  );

  // campaigns — candidate-side lookup hit by the InteractCard's media-sustain
  // detection on every GET /api/characters/[id]/influence when target is at
  // fav=100. Without this, the query degrades to a collection scan as the
  // historical campaigns archive grows.
  await ensureIndex(db, "campaigns", { candidateId: 1 }, { name: "campaigns_candidateId" }, log);
  // electionCandidates — NPP lookups (admin delete, NPP profile queries)
  await ensureIndex(
    db,
    "electionCandidates",
    { nppId: 1 },
    { name: "electionCandidates_nppId", sparse: true },
    log
  );

  // campaigns — election-scoped lookups (election page, resolution)
  await ensureIndex(db, "campaigns", { electionId: 1 }, { name: "campaigns_electionId" }, log);

  // corporationHistory, commodityPriceHistory, actionLogs and
  // statePartyElections are deliberately NOT indexed here. seedSlowQueryIndexes
  // has owned those four since 2026-04-10; they were duplicated into this
  // module on 2026-05-15 with byte-identical collection, key spec, name and
  // options, so each copy bought nothing and cost a no-op round trip per seed.

  // bonds — bondTurn.ts scans active bonds via `find({matured:false})` multiple
  // times per turn (Phase 1 and Phase 7 snapshots, plus stockExchangeSnapshot).
  // Existing compound indexes on (issuerType, countryId, matured) and
  // (holders.characterId, matured, defaulted) cover specific filter shapes,
  // but a leading-matured index supports the bare {matured:false} scan that
  // dominates the turn loop. Currently 608 docs / 86 active in production —
  // adding ahead of growth, not as a hotfix.
  await ensureIndex(db, "bonds", { matured: 1, _id: 1 }, { name: "bonds_matured_id" }, log);
  // Creditor-side lookups: `{"holders.corporationId": id, matured: false}`. The
  // corp detail page and the dissolve preview have always run it; ticket #1198
  // adds the bond-issuance route, which needs a corp's portfolio to price its
  // exit equity. The sibling (holders.characterId, matured, defaulted) index
  // covers the character case but nothing covered the corporate one.
  await ensureIndex(
    db,
    "bonds",
    { "holders.corporationId": 1, matured: 1 },
    { name: "bonds_holderCorp_matured" },
    log
  );

  // Route hot paths: parties, national metrics, stock market, news, and sector detail.
  await ensureIndex(
    db,
    "politicalParties",
    { countryId: 1, isDefunct: 1, isDefault: -1, name: 1 },
    { name: "politicalParties_country_active_sort" },
    log
  );
  await ensureIndex(
    db,
    "characters",
    { countryId: 1, party: 1, userId: 1 },
    { name: "characters_country_party_user" },
    log
  );
  await ensureIndex(db, "users", { isBanned: 1 }, { name: "users_isBanned" }, log);
  await ensureIndex(
    db,
    "npps",
    { countryId: 1, party: 1, retiredAt: 1 },
    { name: "npps_country_party_retired" },
    log
  );
  await ensureIndex(
    db,
    "statePartyOrg",
    { countryId: 1, partyId: 1, organization: 1 },
    { name: "statePartyOrg_country_party_org" },
    log
  );
  await ensureIndex(
    db,
    "partyHistory",
    { countryId: 1, turn: 1, partyId: 1 },
    { name: "partyHistory_country_turn_party" },
    log
  );
  await ensureIndex(db, "states", { countryId: 1 }, { name: "states_countryId" }, log);
  await ensureIndex(
    db,
    "marketCapHistory",
    { turn: -1 },
    { name: "marketCapHistory_turn_desc" },
    log
  );
  await ensureIndex(
    db,
    "wealthListHistory",
    { exchange: 1, turn: -1 },
    { name: "wealthListHistory_exchange_turn_desc" },
    log
  );
  await ensureIndex(
    db,
    "newsPosts",
    { parentId: 1, createdAt: -1 },
    { name: "newsPosts_parent_created_desc" },
    log
  );
  await ensureIndex(
    db,
    "newsPosts",
    { authorId: 1, parentId: 1, createdAt: -1 },
    { name: "newsPosts_author_parent_created_desc" },
    log
  );
  await ensureIndex(
    db,
    "newsPosts",
    { isSystem: 1, createdAt: -1 },
    { name: "newsPosts_system_created_desc" },
    log
  );
  await ensureIndex(
    db,
    "newsReactions",
    { userId: 1, postId: 1 },
    { name: "newsReactions_user_post" },
    log
  );
  await ensureIndex(
    db,
    "billDiscussions",
    { billScope: 1, billId: 1, createdAt: -1 },
    { name: "billDiscussions_thread" },
    log
  );
  await ensureIndex(
    db,
    "billDiscussionReactions",
    { discussionId: 1, userId: 1 },
    { name: "billDiscussionReactions_unique", unique: true },
    log
  );
  await ensureIndex(
    db,
    "wireEvents",
    { timestamp: -1 },
    { name: "wireEvents_timestamp_desc" },
    log
  );
  await ensureIndex(
    db,
    "corporateSectors",
    { stateId: 1, sectorType: 1 },
    { name: "corporateSectors_state_sectorType" },
    log
  );
  await ensureIndex(
    db,
    "corporateSectors",
    { corporationId: 1, stateId: 1 },
    { name: "corporateSectors_corporation_state" },
    log
  );
  await ensureIndex(
    db,
    "unownedSectors",
    { stateId: 1, sectorType: 1 },
    { name: "unownedSectors_state_sectorType" },
    log
  );

  // ipGeoCache — TTL index auto-removes expired IP lookups (30-day cache)
  await ensureIndex(
    db,
    "ipGeoCache",
    { expiresAt: 1 },
    { name: "ipGeoCache_expiresAt_ttl", expireAfterSeconds: 0 },
    log
  );

  // share + currency order books — every trade scans these collections, which
  // grow with cumulative order volume. Keys derived from the actual query
  // predicates (equality on corp/character/type/status; currency reads add a
  // createdAt sort): see placeShareOrder/fillShareOrder/sellPublicShares and
  // forex exchange/orders routes.
  await ensureIndex(
    db,
    "shareOrders",
    { corporationId: 1, characterId: 1, type: 1, status: 1 },
    { name: "shareOrders_corp_char_type_status" },
    log
  );
  await ensureIndex(
    db,
    "shareOrders",
    { corporationId: 1, type: 1, status: 1 },
    { name: "shareOrders_corp_type_status" },
    log
  );
  // Consolidated "My Orders" view scans every open order for one character
  // across all corporations (no corporationId predicate), so the corp-prefixed
  // indexes above cannot serve it. See getMyOpenShareOrders.
  await ensureIndex(
    db,
    "shareOrders",
    { characterId: 1, status: 1 },
    { name: "shareOrders_char_status" },
    log
  );
  await ensureIndex(
    db,
    "shareListings",
    { corporationId: 1, status: 1 },
    { name: "shareListings_corp_status" },
    log
  );
  await ensureIndex(
    db,
    "currencyOrders",
    { type: 1, createdAt: 1, status: 1 },
    { name: "currencyOrders_type_createdAt_status" },
    log
  );
  await ensureIndex(
    db,
    "currencyOrders",
    { characterId: 1, status: 1, createdAt: -1 },
    { name: "currencyOrders_char_status_createdAt" },
    log
  );

  // orgRegLedger — region-page registration sparkline (getStateRegLedger.ts):
  // find({ countryId, stateId, partyId, metric }).sort({ turn: -1 }).limit(24 × rows/turn).
  // The collection grows every turn (regDriftDecay insertMany + build-org
  // inserts); with only the _id index this was a full collection scan.
  await ensureIndex(
    db,
    "orgRegLedger",
    { countryId: 1, stateId: 1, partyId: 1, metric: 1, turn: -1 },
    { name: "reg_ledger_lookup" },
    log
  );

  log("Performance indexes ensured");
}
