import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the API access layer:
 *
 *   - `userApiKeys` — the auth hot path looks keys up by `tokenHash` on every
 *     authenticated public-API request (now also filtering the rotation
 *     `revokeAt` grace window), and the settings UI counts active keys per
 *     scope. A unique `tokenHash` index makes the lookup a point query and
 *     guards against duplicate-hash inserts.
 *   - `apiAccessLog` — Phase-1 instrumentation. TTL-bounded; the secondary
 *     indexes support per-endpoint and per-user abuse-detection scans.
 *   - `rateLimitBuckets` — durable (Mongo-backed) rate-limit counters. The
 *     `expiresAt` TTL index reaps each window once it has elapsed.
 */
export async function seedApiAccessIndexes(db: Db, log: (msg: string) => void) {
  log("API key indexes:");

  await ensureIndex(
    db,
    "userApiKeys",
    { tokenHash: 1 },
    { name: "uak_tokenHash", unique: true },
    log
  );

  await ensureIndex(
    db,
    "userApiKeys",
    { userId: 1, scope: 1, revokedAt: 1 },
    { name: "uak_user_scope_revoked" },
    log
  );

  log("API access log indexes:");

  // 30-day TTL keeps the access log bounded.
  await ensureIndex(
    db,
    "apiAccessLog",
    { timestamp: 1 },
    { name: "aal_timestamp_ttl", expireAfterSeconds: 30 * 24 * 60 * 60 },
    log
  );

  await ensureIndex(db, "apiAccessLog", { path: 1, timestamp: -1 }, { name: "aal_path_time" }, log);

  await ensureIndex(
    db,
    "apiAccessLog",
    { userId: 1, timestamp: -1 },
    { name: "aal_user_time" },
    log
  );

  log("API abuse scan indexes:");

  // 30-day TTL keeps persisted abuse scans bounded.
  await ensureIndex(
    db,
    "apiAbuseScans",
    { detectedAt: 1 },
    { name: "aas_detectedAt_ttl", expireAfterSeconds: 30 * 24 * 60 * 60 },
    log
  );

  log("Rate-limit bucket indexes:");

  // TTL at the document's own expiry instant (expireAfterSeconds: 0 reaps when
  // expiresAt < now), so durable windows clean themselves up.
  await ensureIndex(
    db,
    "rateLimitBuckets",
    { expiresAt: 1 },
    { name: "rlb_expiresAt_ttl", expireAfterSeconds: 0 },
    log
  );

  log("API access indexes ensured");
}
