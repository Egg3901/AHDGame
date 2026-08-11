import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

// Indexes for the admin activity tracking + suspicious-detection system.
// activityLog docs expire 30 days after their timestamp via a TTL index.
export async function seedActivityIndexes(db: Db, log: (msg: string) => void) {
  log("Activity log indexes:");

  // 30-day TTL for rolling activity history
  await ensureIndex(
    db,
    "activityLog",
    { timestamp: 1 },
    { expireAfterSeconds: 2592000, background: true, name: "activityLog_timestamp_ttl" },
    log
  );

  await ensureIndex(
    db,
    "activityLog",
    { userId: 1, timestamp: -1 },
    { background: true, name: "activityLog_userId_timestamp" },
    log
  );
  await ensureIndex(
    db,
    "activityLog",
    { characterId: 1, timestamp: -1 },
    { background: true, name: "activityLog_characterId_timestamp" },
    log
  );
  await ensureIndex(
    db,
    "activityLog",
    { type: 1, timestamp: -1 },
    { background: true, name: "activityLog_type_timestamp" },
    log
  );

  // IP grouping for suspicious detection — sparse because only login events carry ipAddress
  await ensureIndex(
    db,
    "activityLog",
    { ipAddress: 1, timestamp: -1 },
    { sparse: true, background: true, name: "activityLog_ipAddress_timestamp" },
    log
  );
  await ensureIndex(
    db,
    "activityLog",
    { trackingId: 1, timestamp: -1 },
    { sparse: true, background: true, name: "activityLog_trackingId_timestamp" },
    log
  );
  await ensureIndex(
    db,
    "activityLog",
    { fingerprint: 1, timestamp: -1 },
    { sparse: true, background: true, name: "activityLog_fingerprint_timestamp" },
    log
  );

  await ensureIndex(
    db,
    "activityLog",
    { username: "text", characterName: "text" },
    { background: true, name: "activityLog_text_search" },
    log
  );

  // toId/toType lookup powers the fund-concentration detector
  await ensureIndex(
    db,
    "activityLog",
    { toId: 1, toType: 1, timestamp: -1 },
    { sparse: true, background: true, name: "activityLog_toId_toType_timestamp" },
    log
  );

  // Campaign-strength contribution aggregation (campaign-strength detail route)
  await ensureIndex(
    db,
    "activityLog",
    { actionType: 1, "details.campaignId": 1, turn: 1 },
    { sparse: true, background: true, name: "activityLog_actionType_campaignId_turn" },
    log
  );

  // Direct target lookups for explicit game-action audit rows such as
  // campaign-strength support events.
  await ensureIndex(
    db,
    "activityLog",
    { targetId: 1, targetType: 1, timestamp: -1 },
    { sparse: true, background: true, name: "activityLog_targetId_targetType_timestamp" },
    log
  );

  // actionLogs — the automation detector reads recent actions per user
  // (detectAutomationTiming's userId+createdAt lookup, and the recent-action
  // candidate-expansion distinct). Existing actionLogs indexes are keyed on
  // characterId/actionType, which don't serve these.
  await ensureIndex(
    db,
    "actionLogs",
    { userId: 1, createdAt: -1 },
    { background: true, name: "actionLogs_userId_createdAt" },
    log
  );

  log("Suspicious character indexes:");

  await ensureIndex(
    db,
    "suspiciousCharacters",
    { characterId: 1 },
    { unique: true, background: true, name: "suspiciousCharacters_characterId" },
    log
  );
  await ensureIndex(
    db,
    "suspiciousCharacters",
    { dismissed: 1, highestSeverity: 1, flagCount: -1 },
    { background: true, name: "suspiciousCharacters_triage" },
    log
  );
  await ensureIndex(
    db,
    "suspiciousCharacters",
    { dismissed: 1, countryId: 1 },
    { background: true, name: "suspiciousCharacters_dismissed_countryId" },
    log
  );

  log("Activity indexes ensured");
}
