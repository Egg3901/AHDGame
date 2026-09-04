import type { Db } from "mongodb";
import { normalizeAndMergeCorporateSectors } from "@/lib/corporations/repairDuplicateSectors";
import { ensureIndex } from "./helpers";

const CORPORATE_SECTOR_IDENTITY_INDEX_NAME = "corporateSectors_corporationId_stateId_sectorType";
const CORPORATE_SECTOR_IDENTITY_INDEX_KEY = {
  corporationId: 1,
  stateId: 1,
  sectorType: 1,
} as const;

function hasCorporateSectorIdentityIndex(
  indexes: Array<{ key?: unknown; unique?: boolean }>
): boolean {
  const serializedKey = JSON.stringify(CORPORATE_SECTOR_IDENTITY_INDEX_KEY);
  return indexes.some(
    (index) => JSON.stringify(index.key ?? {}) === serializedKey && index.unique === true
  );
}

// Core identity and lookup indexes on user-facing collections.
// These are the bare-minimum indexes the app needs to function.
export async function seedCoreIndexes(db: Db, log: (msg: string) => void) {
  log("Core indexes:");

  await ensureIndex(db, "users", { email: 1 }, { unique: true, name: "users_email" }, log);
  await ensureIndex(db, "users", { username: 1 }, { unique: true, name: "users_username" }, log);
  await ensureIndex(
    db,
    "users",
    { lastActivity: 1, isBanned: 1 },
    { name: "users_lastActivity_isBanned" },
    log
  );
  // Powers the IP-collision check at registration (see registrationGate.ts).
  await ensureIndex(
    db,
    "users",
    { registrationIp: 1 },
    { sparse: true, name: "users_registrationIp" },
    log
  );

  // Discord support tickets: unique display number + unique active channel,
  // plus the triage worker's status/reviewAfter scan.
  await ensureIndex(
    db,
    "tickets",
    { ticketNumber: 1 },
    { unique: true, sparse: true, name: "tickets_ticketNumber" },
    log
  );
  await ensureIndex(
    db,
    "tickets",
    { discordChannelId: 1 },
    { unique: true, sparse: true, name: "tickets_discordChannelId" },
    log
  );
  await ensureIndex(
    db,
    "tickets",
    { status: 1, reviewAfter: 1 },
    { name: "tickets_status_reviewAfter" },
    log
  );

  await ensureIndex(db, "characters", { userId: 1 }, { name: "characters_userId" }, log);
  await ensureIndex(db, "characters", { homeState: 1 }, { name: "characters_homeState" }, log);
  await ensureIndex(
    db,
    "characters",
    { sequentialId: 1 },
    { unique: true, sparse: true, name: "characters_sequentialId" },
    log
  );
  await ensureIndex(db, "characters", { countryId: 1 }, { name: "characters_countryId" }, log);

  await ensureIndex(db, "states", { region: 1 }, { name: "states_region" }, log);

  await ensureIndex(db, "statePartyOrg", { stateId: 1 }, { name: "statePartyOrg_stateId" }, log);

  // One row per (country, state, party). The compound `_id` (`${stateId}_${partyId}`)
  // is derived from these fields, and a drifted `_id` is how one party's org
  // ended up readable as another's (ticket #1256). Unique at the field level so
  // a future writer can never double-claim a (state, party) chapter row.
  await ensureIndex(
    db,
    "statePartyOrg",
    { countryId: 1, stateId: 1, partyId: 1 },
    { unique: true, name: "statePartyOrg_country_state_party_unique" },
    log
  );

  // characterStateOrg: presidential-primary regional bases. Unique compound
  // key guarantees the atomic findOneAndUpdate in
  // /api/political-operations/state-org/build cannot create duplicate rows
  // under concurrent requests. See
  // docs/plans/archive/2026-05/2026-05-27-presidential-primary-regional-bases-design.md
  await ensureIndex(
    db,
    "characterStateOrg",
    { characterId: 1, stateId: 1 },
    { unique: true, name: "characterStateOrg_characterId_stateId" },
    log
  );
  await ensureIndex(
    db,
    "characterStateOrg",
    { stateId: 1 },
    { name: "characterStateOrg_stateId" },
    log
  );

  // primaryStateActions: one row per act against a rival in a state during a
  // presidential primary. The turn engine reads by (election, state, expiry);
  // the state operations panel reads "what is being done to me" by
  // (election, target).
  await ensureIndex(
    db,
    "primaryStateActions",
    { electionId: 1, stateId: 1, expiresTurn: 1 },
    { name: "primaryStateActions_election_state_expires" },
    log
  );
  await ensureIndex(
    db,
    "primaryStateActions",
    { electionId: 1, targetCandidateId: 1 },
    { name: "primaryStateActions_election_target" },
    log
  );

  await ensureIndex(
    db,
    "npps",
    { sequentialId: 1 },
    { unique: true, sparse: true, name: "npps_sequentialId" },
    log
  );
  await ensureIndex(db, "npps", { countryId: 1 }, { name: "npps_countryId" }, log);
  await ensureIndex(
    db,
    "nppForeignPolicyDecisions",
    { countryId: 1, turn: 1 },
    { unique: true, name: "nppForeignPolicyDecisions_country_turn" },
    log
  );

  await ensureIndex(
    db,
    "corporations",
    { sequentialId: 1 },
    { unique: true, sparse: true, name: "corporations_sequentialId" },
    log
  );
  await ensureIndex(db, "corporations", { ceoId: 1 }, { name: "corporations_ceoId" }, log);
  // Supports sellNppStockSurplus's per-cycle scan (nppActionProcessing.ts) for
  // corps with an NPP shareholder — a full collection scan without this,
  // found while auditing scalability toward a 30-50-country sim (this
  // collection grows with country/sector count).
  await ensureIndex(
    db,
    "corporations",
    { "shareholders.nppId": 1 },
    { sparse: true, name: "corporations_shareholders_nppId" },
    log
  );
  await ensureIndex(
    db,
    "corporations",
    { headquartersState: 1 },
    { name: "corporations_headquartersState" },
    log
  );
  await ensureIndex(
    db,
    "corporations",
    { tickerSymbol: 1 },
    {
      unique: true,
      partialFilterExpression: { tickerSymbol: { $exists: true, $type: "string" } },
      name: "corporations_tickerSymbol_unique",
    },
    log
  );

  await ensureIndex(
    db,
    "corporateSectors",
    { corporationId: 1 },
    { name: "corporateSectors_corporationId" },
    log
  );
  await ensureIndex(
    db,
    "corporateSectors",
    { stateId: 1 },
    { name: "corporateSectors_stateId" },
    log
  );
  // Dirty environments can still carry pre-fix duplicate sectors, which blocks the unique index
  // that now enforces the invariant at write time.
  const corporateSectorIndexes = await db.collection("corporateSectors").indexes();
  if (!hasCorporateSectorIdentityIndex(corporateSectorIndexes)) {
    const { normalizedSectors, mergedGroups } = await normalizeAndMergeCorporateSectors(
      db,
      new Date()
    );
    if (normalizedSectors.length > 0 || mergedGroups.length > 0) {
      log(
        `  ~ corporateSectors.${CORPORATE_SECTOR_IDENTITY_INDEX_NAME} prerequisites repaired ` +
          `(${normalizedSectors.length} country normalizations, ${mergedGroups.length} duplicate merges)`
      );
    }
  }
  await ensureIndex(
    db,
    "corporateSectors",
    CORPORATE_SECTOR_IDENTITY_INDEX_KEY,
    { unique: true, name: CORPORATE_SECTOR_IDENTITY_INDEX_NAME },
    log
  );

  await ensureIndex(
    db,
    "politicalParties",
    { countryId: 1 },
    { name: "politicalParties_countryId" },
    log
  );

  await ensureIndex(
    db,
    "politicalParties",
    { countryId: 1, sequentialId: 1 },
    { unique: true, name: "politicalParties_countryId_sequentialId" },
    log
  );

  // Registration IP-policy collection (see registrationGate.ts).
  await ensureIndex(db, "bannedIps", { ip: 1 }, { unique: true, name: "bannedIps_ip" }, log);
  await ensureIndex(db, "bannedIps", { bannedAt: -1 }, { name: "bannedIps_bannedAt" }, log);

  log("Core indexes ensured");
}
