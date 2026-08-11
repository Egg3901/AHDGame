/**
 * POST /api/admin/heal/executive-duplicates
 *
 * Fixes duplicate US president/vicePresident records:
 *  1. Finds characters with currentOffice.type = president/vicePresident
 *  2. Checks if they're actually the current holder in electedOfficials
 *  3. Clears currentOffice for those who aren't the actual holder
 *
 * This handles cases where admin appointments created duplicate records
 * or old holders weren't properly cleared.
 *
 * NOTE: Scoped to countryId === "US". CN also seats a ceremonial President
 * (auto-populated from CCP.chairId by partyChairHeadOfState) — that's not a US
 * executive duplicate and must not be touched here.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { ElectedOfficial, Character } from "@/lib/db/types";

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // Find the actual current US president and VP from electedOfficials
    const executives = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: "US",
        officeType: { $in: ["president", "vicePresident"] },
        characterId: { $ne: null },
      })
      .toArray();

    // Build sets of actual holders by office type
    const actualPresidentIds = new Set<string>();
    const actualVPIds = new Set<string>();

    for (const exec of executives) {
      if (exec.characterId) {
        if (exec.officeType === "president") {
          actualPresidentIds.add(exec.characterId.toString());
        } else if (exec.officeType === "vicePresident") {
          actualVPIds.add(exec.characterId.toString());
        }
      }
    }

    // Find characters who claim to be US president but aren't
    const fakePresidents = await db
      .collection<Character>("characters")
      .find({
        countryId: "US",
        "currentOffice.type": "president",
      })
      .toArray();

    // Find characters who claim to be US VP but aren't
    const fakeVPs = await db
      .collection<Character>("characters")
      .find({
        countryId: "US",
        "currentOffice.type": "vicePresident",
      })
      .toArray();

    let clearedCount = 0;
    const clearedNames: string[] = [];

    // Clear fake presidents
    for (const char of fakePresidents) {
      if (!actualPresidentIds.has(char._id.toString())) {
        await db
          .collection("characters")
          .updateOne({ _id: char._id }, { $set: { currentOffice: null, updatedAt: now } });
        clearedCount++;
        clearedNames.push(`${char.name} (was President)`);
      }
    }

    // Clear fake VPs
    for (const char of fakeVPs) {
      if (!actualVPIds.has(char._id.toString())) {
        await db
          .collection("characters")
          .updateOne({ _id: char._id }, { $set: { currentOffice: null, updatedAt: now } });
        clearedCount++;
        clearedNames.push(`${char.name} (was VP)`);
      }
    }

    // Also check for duplicate electedOfficials records (multiple VP records, etc.)
    // Keep only the most recently updated one per office type
    const duplicateTypes = ["president", "vicePresident"];
    let duplicatesRemoved = 0;

    for (const officeType of duplicateTypes) {
      const records = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ countryId: "US", officeType })
        .sort({ updatedAt: -1 })
        .toArray();

      if (records.length > 1) {
        // Keep the first (most recent), delete the rest
        const toDelete = records.slice(1).map((r) => r._id);
        if (toDelete.length > 0) {
          const result = await db
            .collection("electedOfficials")
            .deleteMany({ _id: { $in: toDelete } });
          duplicatesRemoved += result.deletedCount;
        }
      }
    }

    return NextResponse.json({
      success: true,
      clearedCount,
      clearedNames,
      duplicatesRemoved,
      actualPresidents: executives
        .filter((e) => e.officeType === "president")
        .map((e) => e.characterName),
      actualVPs: executives
        .filter((e) => e.officeType === "vicePresident")
        .map((e) => e.characterName),
      message: `Cleared ${clearedCount} stale executive office(s). Removed ${duplicatesRemoved} duplicate record(s).`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET to preview what would be cleaned
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Find actual US executives
    const executives = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: "US",
        officeType: { $in: ["president", "vicePresident"] },
      })
      .toArray();

    // Find all US characters claiming executive offices
    const claimingExecutive = await db
      .collection<Character>("characters")
      .find({
        countryId: "US",
        "currentOffice.type": { $in: ["president", "vicePresident"] },
      })
      .toArray();

    const actualHolderIds = new Set(
      executives.filter((e) => e.characterId).map((e) => e.characterId!.toString())
    );

    const stale = claimingExecutive.filter((c) => !actualHolderIds.has(c._id.toString()));

    return NextResponse.json({
      actualExecutives: executives.map((e) => ({
        officeType: e.officeType,
        characterName: e.characterName,
        characterId: e.characterId?.toString(),
      })),
      claimingExecutive: claimingExecutive.map((c) => ({
        name: c.name,
        officeType: c.currentOffice?.type,
        isActual: actualHolderIds.has(c._id.toString()),
      })),
      staleCount: stale.length,
      staleNames: stale.map((c) => `${c.name} (${c.currentOffice?.type})`),
      duplicateRecords: executives.length > 2 ? executives.length - 2 : 0,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
