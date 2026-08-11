/**
 * Corporations whose CEO has not been active within the last
 * INACTIVE_CEO_TURN_THRESHOLD turns (= hours, since AHD runs one turn/hour)
 * shed market footprint at the same rate as fully vacant corps. CEO retains
 * full authority; shed stops automatically the next turn after the user returns.
 *
 * Runs immediately after `shedVacantCeoSectorsToUnowned` — vacant corps are
 * excluded here so they don't double-shed in a single turn.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, User } from "@/lib/db/types";
import type { CorporationLookups } from "./types";
import { shedSectorsForCorps, type SectorShedResult } from "./corporationSectorShed";
import { VACANT_CEO_SECTOR_SHED_RATE } from "./vacantCeoSectorShed";

/** Turns of inactivity before the inactive-CEO shed kicks in (= 72 real-time hours). */
export const INACTIVE_CEO_TURN_THRESHOLD = 72;

const TURN_MS = 60 * 60 * 1000;

/**
 * Ordinary player character-CEO corp eligible for inactive-CEO penalties
 * (sector shed AND cross-corp share release). Shared so both penalties use one
 * definition. Excludes vacant, imperial-/NPP-run, nationalized, and
 * country-owned corps, and corps with no owning user.
 */
export function isInactiveCeoPenaltyCandidate(
  corp: Pick<Corporation, "countryOwnerId" | "ceoVacant" | "isNationalized" | "ceoType" | "userId">
): boolean {
  if (corp.ceoVacant === true) return false;
  if (corp.ceoType === "imperial") return false;
  if (corp.ceoType === "npp") return false; // NPP corps are AI-run, never inactive
  if (corp.countryOwnerId != null) return false;
  if (corp.isNationalized) return false;
  if (corp.userId == null) return false;
  return true;
}

export async function shedInactiveCeoSectorsToUnowned(
  db: Db,
  lookups: CorporationLookups,
  now: Date,
  /** `marketSystemMode >= "plants"` — sheds capacity units instead of revenue. */
  plantsEnabled: boolean = false
): Promise<SectorShedResult> {
  const candidates = lookups.corporations.filter(isInactiveCeoPenaltyCandidate);
  if (candidates.length === 0) {
    return { corporateSectorsUpdated: 0, unownedSectorsUpdated: 0, totalRevenueShed: 0 };
  }

  const userIds = Array.from(
    new Set(
      candidates.map((c) => c.userId?.toString()).filter((s): s is string => typeof s === "string")
    )
  ).map((s) => new ObjectId(s));

  const users = await db
    .collection<User>("users")
    .find({ _id: { $in: userIds } })
    .project<{ _id: ObjectId; lastActivity?: Date; createdAt?: Date }>({
      _id: 1,
      lastActivity: 1,
      createdAt: 1,
    })
    .toArray();

  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  const cutoffMs = now.getTime() - INACTIVE_CEO_TURN_THRESHOLD * TURN_MS;

  const inactive: Corporation[] = [];
  for (const corp of candidates) {
    if (corp.userId == null) continue;
    const u = userById.get(corp.userId.toString());
    if (!u) {
      console.warn(
        `[Turn] Inactive CEO shed: corp ${corp.name ?? corp._id} userId ${corp.userId} has no user doc — skipping`
      );
      continue;
    }
    const reference = u.lastActivity ?? u.createdAt;
    if (!reference) {
      console.warn(
        `[Turn] Inactive CEO shed: user ${u._id} has neither lastActivity nor createdAt — skipping`
      );
      continue;
    }
    if (reference.getTime() < cutoffMs) {
      inactive.push(corp);
    }
  }

  return shedSectorsForCorps(
    db,
    lookups,
    inactive,
    VACANT_CEO_SECTOR_SHED_RATE,
    now,
    "Inactive CEO",
    plantsEnabled
  );
}
