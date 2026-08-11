import { ObjectId, type Db } from "mongodb";
import type { Election } from "@/lib/db/types";
import { isHexObjectIdString } from "@/lib/utils/objectIdHex";

/**
 * True when `id` is a seat slug (e.g. US-president), not a 24-char hex ObjectId.
 * Mirrors GET /api/elections/[id].
 */
export function isElectionRouteSeatId(id: string): boolean {
  if (isHexObjectIdString(id)) return false;
  const parts = id.split("-");
  if (parts.length < 2) return false;
  if (!/^[A-Z]{2}$/i.test(parts[0])) return false;
  return true;
}

async function findElectionForSeatId(db: Db, seatId: string): Promise<Election | null> {
  const elections = await db
    .collection<Election>("elections")
    .find({ seatId })
    .sort({ cycle: -1 })
    .limit(10)
    .toArray();
  return (
    elections.find((e) => e.status === "active") ??
    elections.find((e) => e.status === "upcoming") ??
    elections[0] ??
    null
  );
}

export type ResolveElectionRouteParamResult =
  { ok: true; election: Election } | { ok: false; reason: "invalid_id" | "not_found" };

/**
 * Resolve a dynamic elections route segment: Mongo ObjectId or seatId (e.g. US-president).
 * Prefer active, then upcoming, then most recent by cycle (same as election detail GET without ?cycle=).
 */
export async function resolveElectionRouteParam(
  db: Db,
  electionId: string
): Promise<ResolveElectionRouteParamResult> {
  if (isElectionRouteSeatId(electionId)) {
    const election = await findElectionForSeatId(db, electionId);
    return election ? { ok: true, election } : { ok: false, reason: "not_found" };
  }
  try {
    const oid = new ObjectId(electionId);
    const election = await db.collection<Election>("elections").findOne({ _id: oid });
    return election ? { ok: true, election } : { ok: false, reason: "not_found" };
  } catch {
    return { ok: false, reason: "invalid_id" };
  }
}
