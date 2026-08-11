/**
 * POST /api/admin/heal/stale-admin-appointments
 *
 * Removes stale admin-appointed officials that should have been replaced
 * by election winners. This handles cases where:
 * 1. Admin appointed someone to a seat
 * 2. An election resolved for that seat with a different winner
 * 3. The admin-appointed record was never cleaned up
 *
 * The endpoint identifies duplicates by seat key (officeType + state + senateClass/district).
 * When choosing which to keep:
 * - Prefer filled records (has characterId or nppId) over vacant ones
 * - Among equally-filled records, keep the most recent (by electedAt then updatedAt)
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { ElectedOfficial, Character, NPP } from "@/lib/db/types";

interface DuplicateSeat {
  seatKey: string;
  officeType: string;
  state?: string;
  senateClass?: number;
  district?: number;
  records: Array<{
    id: string;
    characterName: string | null;
    isNPP: boolean;
    isFilled: boolean;
    electedAt: Date | null;
    updatedAt: Date;
    isKept: boolean;
  }>;
}

function getSeatKey(official: ElectedOfficial): string {
  const parts = [official.officeType];
  if (official.state) parts.push(official.state);
  if (official.senateClass != null) parts.push(`class${official.senateClass}`);
  if (official.district != null) parts.push(`district${official.district}`);
  return parts.join(":");
}

function isFilled(official: ElectedOfficial): boolean {
  return official.characterId != null || official.nppId != null;
}

/**
 * Sort officials to determine which to keep:
 * 1. Filled records before vacant records
 * 2. Among same fill status, most recent electedAt first
 * 3. Then most recent updatedAt
 */
function sortOfficials(a: ElectedOfficial, b: ElectedOfficial): number {
  // Filled records come first
  const aFilled = isFilled(a) ? 1 : 0;
  const bFilled = isFilled(b) ? 1 : 0;
  if (bFilled !== aFilled) return bFilled - aFilled;

  // Then by electedAt (most recent first)
  const aElected = a.electedAt?.getTime() ?? 0;
  const bElected = b.electedAt?.getTime() ?? 0;
  if (bElected !== aElected) return bElected - aElected;

  // Then by updatedAt
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Get all officials
    const officials = await db.collection<ElectedOfficial>("electedOfficials").find({}).toArray();

    // Group by seat key
    const bySeat = new Map<string, ElectedOfficial[]>();
    for (const official of officials) {
      const key = getSeatKey(official);
      const list = bySeat.get(key) ?? [];
      list.push(official);
      bySeat.set(key, list);
    }

    // Find seats with duplicates
    const duplicates: DuplicateSeat[] = [];
    let totalStale = 0;

    for (const [seatKey, records] of bySeat.entries()) {
      if (records.length <= 1) continue;

      // Sort to determine which to keep
      const sorted = [...records].sort(sortOfficials);

      // The first one is kept, the rest are stale
      const staleCount = sorted.length - 1;
      totalStale += staleCount;

      duplicates.push({
        seatKey,
        officeType: sorted[0].officeType,
        state: sorted[0].state,
        senateClass: sorted[0].senateClass,
        district: sorted[0].district,
        records: sorted.map((r, i) => ({
          id: r._id.toString(),
          characterName: r.characterName ?? null,
          isNPP: r.isNPP ?? false,
          isFilled: isFilled(r),
          electedAt: r.electedAt ?? null,
          updatedAt: r.updatedAt,
          isKept: i === 0,
        })),
      });
    }

    return NextResponse.json({
      status: duplicates.length > 0 ? "needs_fix" : "ok",
      message:
        duplicates.length > 0
          ? `Found ${duplicates.length} seat(s) with ${totalStale} stale record(s).`
          : "No duplicate officials found.",
      totalOfficials: officials.length,
      duplicateSeats: duplicates.length,
      staleRecords: totalStale,
      duplicates,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // Get all officials
    const officials = await db.collection<ElectedOfficial>("electedOfficials").find({}).toArray();

    // Group by seat key
    const bySeat = new Map<string, ElectedOfficial[]>();
    for (const official of officials) {
      const key = getSeatKey(official);
      const list = bySeat.get(key) ?? [];
      list.push(official);
      bySeat.set(key, list);
    }

    let removedCount = 0;
    let clearedCharacters = 0;
    let clearedNPPs = 0;
    const removedNames: string[] = [];

    for (const [, records] of bySeat.entries()) {
      if (records.length <= 1) continue;

      // Sort to determine which to keep
      const sorted = [...records].sort(sortOfficials);

      // Remove all except the first (the one we're keeping)
      const toRemove = sorted.slice(1);

      for (const stale of toRemove) {
        // Clear currentOffice from character/NPP if they still reference this office
        if (stale.characterId) {
          const char = await db
            .collection<Character>("characters")
            .findOne({ _id: stale.characterId });
          if (char?.currentOffice?.type === stale.officeType) {
            await db
              .collection("characters")
              .updateOne(
                { _id: stale.characterId },
                { $set: { currentOffice: null, updatedAt: now } }
              );
            clearedCharacters++;
          }
        } else if (stale.nppId) {
          const npp = await db.collection<NPP>("npps").findOne({ _id: stale.nppId });
          if (npp?.currentOffice?.type === stale.officeType) {
            await db
              .collection("npps")
              .updateOne({ _id: stale.nppId }, { $set: { currentOffice: null, updatedAt: now } });
            clearedNPPs++;
          }
        }

        // Delete the stale record
        await db.collection("electedOfficials").deleteOne({ _id: stale._id });
        removedCount++;
        const fillStatus = isFilled(stale) ? "" : " [vacant]";
        removedNames.push(
          `${stale.characterName ?? "Vacant"}${fillStatus} (${stale.officeType}${stale.state ? ` - ${stale.state}` : ""})`
        );
      }
    }

    return NextResponse.json({
      success: true,
      removedCount,
      clearedCharacters,
      clearedNPPs,
      removedNames: removedNames.slice(0, 50), // Limit output size
      message: `Removed ${removedCount} stale official record(s). Cleared currentOffice from ${clearedCharacters} character(s) and ${clearedNPPs} NPP(s).`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
