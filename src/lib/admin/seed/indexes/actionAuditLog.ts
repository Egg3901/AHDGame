import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the unified action-audit spine (forensics/alt-detection rework
 * plan §3.1). `actionAuditLog` is a small normalized envelope written from a
 * handful of choke points; these indexes cover the read patterns the
 * Forensic Explorer / audit query API / anomaly scanner need: recency,
 * trace-following, per-actor and per-subject history, and TTL cleanup
 * (belt-and-suspenders — the retention pipeline archives to R2 first).
 */
export async function seedActionAuditLogIndexes(db: Db, log: (msg: string) => void) {
  log("Action audit log indexes:");

  await ensureIndex(
    db,
    "actionAuditLog",
    { turn: -1 },
    { name: "actionAuditLog_turn_desc", background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { ts: -1 },
    { name: "actionAuditLog_ts_desc", background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { traceId: 1, seq: 1 },
    { name: "actionAuditLog_traceId_seq", background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { "actor.userId": 1, ts: -1 },
    { name: "actionAuditLog_actorUserId_ts", background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { "actor.characterId": 1, ts: -1 },
    { name: "actionAuditLog_actorCharacterId_ts", background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { "subject.type": 1, "subject.id": 1, ts: -1 },
    { name: "actionAuditLog_subjectType_subjectId_ts", background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { action: 1, ts: -1 },
    { name: "actionAuditLog_action_ts", background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { category: 1, ts: -1 },
    { name: "actionAuditLog_category_ts", background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { flags: 1, ts: -1 },
    { name: "actionAuditLog_flags_ts", sparse: true, background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { "net.fingerprint": 1, ts: -1 },
    { name: "actionAuditLog_netFingerprint_ts", sparse: true, background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { "net.ipHash": 1, ts: -1 },
    { name: "actionAuditLog_netIpHash_ts", sparse: true, background: true },
    log
  );

  // Partial: only money-category rows carry `amount`, so this index skips
  // the (large) majority of governance/system/auth rows entirely.
  await ensureIndex(
    db,
    "actionAuditLog",
    { amount: -1 },
    {
      name: "actionAuditLog_amount_desc_money",
      partialFilterExpression: { category: "money" },
      background: true,
    },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { expiresAt: 1 },
    { name: "actionAuditLog_expiresAt_ttl", expireAfterSeconds: 0, background: true },
    log
  );

  await ensureIndex(
    db,
    "actionAuditLog",
    { "actor.name": "text", "subject.name": "text" },
    { name: "actionAuditLog_text_search", background: true },
    log
  );

  log("Action audit log indexes ensured");
}
