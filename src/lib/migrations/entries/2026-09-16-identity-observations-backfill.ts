import type { Db, ObjectId } from "mongodb";
import {
  IDENTITY_OBSERVATIONS_COLLECTION,
  type IdentityObservation,
  type IdentityTrack,
} from "@/lib/db/types/identityObservation";
import { isGroupableIdentityValue } from "@/lib/identityHistory/guards";
import type { Migration, MigrationContext, MigrationResult } from "../types";

export interface BackfillUser {
  _id: ObjectId;
  createdAt: Date;
  updatedAt?: Date;
  lastLogin?: Date | null;
  registrationIp?: string | null;
  lastKnownIp?: string | null;
  lastKnownIpAt?: Date | null;
  registrationFingerprint?: string | null;
  registrationFingerprintAt?: Date | null;
  lastFingerprint?: string | null;
  lastFingerprintAt?: Date | null;
  fingerprintHistory?: string[];
}

/** Mongo enforces no schema, so a legacy row can carry a missing or malformed
 * value where the type promises a Date. Mirrors `isUsableDate` in
 * src/lib/auth/identitySignals.ts. */
function usable(value: unknown): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

function firstUsable(...candidates: Array<Date | null | undefined>): Date | null {
  for (const candidate of candidates) {
    const date = usable(candidate);
    if (date) return date;
  }
  return null;
}

/**
 * Seed runs from the scalar fields already on a user document.
 *
 * `fingerprintHistory` carries NO timestamps, so entries not already covered by
 * the dated fields get `datesKnown: false` and are anchored to `updatedAt`
 * purely so the TTL has something to reap against. The UI renders them as
 * "date unknown". Do NOT invent timestamps for them.
 */
export function buildBackfillRows(user: BackfillUser): IdentityObservation[] {
  const rows: IdentityObservation[] = [];
  const createdAt = usable(user.createdAt);
  const anchor = firstUsable(user.updatedAt, createdAt) ?? new Date();

  const push = (
    track: IdentityTrack,
    value: string | null | undefined,
    observedAt: Date | null,
    datesKnown: boolean
  ) => {
    if (!isGroupableIdentityValue(track, value)) return;
    // Keyed on (track, value), not value alone: the two tracks are independent
    // namespaces and must not dedupe against each other.
    if (rows.some((r) => r.track === track && r.value === value)) return;
    const when = observedAt ?? anchor;
    rows.push({
      userId: user._id,
      track,
      value,
      firstSeen: when,
      lastSeen: when,
      observations: 1,
      source: "backfill",
      datesKnown,
    });
  };

  push("ip", user.registrationIp, createdAt, true);
  push("ip", user.lastKnownIp, firstUsable(user.lastKnownIpAt, user.lastLogin, createdAt), true);
  push(
    "fingerprint",
    user.registrationFingerprint,
    firstUsable(user.registrationFingerprintAt, createdAt),
    true
  );
  push(
    "fingerprint",
    user.lastFingerprint,
    firstUsable(user.lastFingerprintAt, user.lastLogin, createdAt),
    true
  );

  for (const historical of user.fingerprintHistory ?? []) {
    push("fingerprint", historical, anchor, false);
  }

  return rows;
}

async function backfill(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const users = await db
    .collection<BackfillUser>("users")
    .find(
      {},
      {
        projection: {
          _id: 1,
          createdAt: 1,
          updatedAt: 1,
          lastLogin: 1,
          registrationIp: 1,
          lastKnownIp: 1,
          lastKnownIpAt: 1,
          registrationFingerprint: 1,
          registrationFingerprintAt: 1,
          lastFingerprint: 1,
          lastFingerprintAt: 1,
          fingerprintHistory: 1,
        },
      }
    )
    .toArray();

  const collection = db.collection<IdentityObservation>(IDENTITY_OBSERVATIONS_COLLECTION);
  let inserted = 0;
  let skipped = 0;

  for (const user of users) {
    // Idempotent: a user already carrying backfill rows is left alone, so a
    // re-run never duplicates and never clobbers live runs recorded since.
    const existing = await collection.countDocuments(
      { userId: user._id, source: "backfill" },
      { limit: 1 }
    );
    if (existing > 0) {
      skipped++;
      continue;
    }
    const rows = buildBackfillRows(user);
    if (rows.length === 0) continue;
    if (!ctx.dryRun) await collection.insertMany(rows);
    inserted += rows.length;
  }

  return {
    documentsScanned: users.length,
    documentsInserted: ctx.dryRun ? 0 : inserted,
    notes: [
      `${users.length} users scanned`,
      `${inserted} runs ${ctx.dryRun ? "would be " : ""}inserted`,
      `${skipped} users already backfilled`,
    ],
  };
}

export const migration: Migration = {
  id: "2026-09-16-identity-observations-backfill",
  description:
    "Seed identityObservations runs from the scalar identity fields and fingerprintHistory on users, so rotated-away values become visible and groupable.",
  idempotent: true,
  execute: backfill,
};
