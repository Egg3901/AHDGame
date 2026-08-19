import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Character, State, User } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

// GET /api/admin/heal/discord-users — Diagnoses user/character linkage issues and characters missing countryId
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const [allUsers, allChars] = await Promise.all([
      db.collection<User>("users").find({}).toArray(),
      db.collection<Character>("characters").find({}).toArray(),
    ]);

    // Build a map of userId -> character for fast lookups
    const charByUserId = new Map<string, Character>();
    for (const c of allChars) {
      charByUserId.set(c.userId.toString(), c);
    }

    // A: Users with no activeCharacterId but a character exists
    let usersWithoutActiveCharacterId = 0;
    for (const user of allUsers) {
      if (!user.activeCharacterId) {
        if (charByUserId.has(user._id.toString())) {
          usersWithoutActiveCharacterId++;
        }
      }
    }

    // Build a map of characterId -> character for broken link check
    const charById = new Map<string, Character>();
    for (const c of allChars) {
      charById.set(c._id.toString(), c);
    }

    // B: Users whose activeCharacterId points to a non-existent character (or wrong userId)
    let brokenActiveCharacterIdLinks = 0;
    for (const user of allUsers) {
      if (user.activeCharacterId) {
        const charIdStr = user.activeCharacterId.toString();
        const pointedChar = charById.get(charIdStr);
        if (!pointedChar || pointedChar.userId.toString() !== user._id.toString()) {
          brokenActiveCharacterIdLinks++;
        }
      }
    }

    // C: Characters missing countryId
    const charactersMissingCountryId = await db.collection<Character>("characters").countDocuments({
      countryId: { $exists: false },
    });

    const totalIssues =
      usersWithoutActiveCharacterId + brokenActiveCharacterIdLinks + charactersMissingCountryId;

    return NextResponse.json({
      status: totalIssues === 0 ? "ok" : "issues_found",
      message:
        totalIssues === 0
          ? "All user/character links are healthy and all characters have countryId."
          : `Found ${totalIssues} issue(s): ${usersWithoutActiveCharacterId} missing activeCharacterId, ${brokenActiveCharacterIdLinks} broken links, ${charactersMissingCountryId} characters missing countryId.`,
      usersWithoutActiveCharacterId,
      brokenActiveCharacterIdLinks,
      charactersMissingCountryId,
      totalUsersChecked: allUsers.length,
      totalCharactersChecked: allChars.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/heal/discord-users — Fixes missing activeCharacterId, broken links, and missing countryId
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    const [allUsers, allChars] = await Promise.all([
      db.collection<User>("users").find({}).toArray(),
      db.collection<Character>("characters").find({}).toArray(),
    ]);

    const charByUserId = new Map<string, Character>();
    for (const c of allChars) {
      charByUserId.set(c.userId.toString(), c);
    }

    const charById = new Map<string, Character>();
    for (const c of allChars) {
      charById.set(c._id.toString(), c);
    }

    let fixedActiveCharacterIds = 0;
    let fixedBrokenLinks = 0;

    for (const user of allUsers) {
      const userId = user._id.toString();

      if (!user.activeCharacterId) {
        // A: Missing activeCharacterId — set from character lookup
        const char = charByUserId.get(userId);
        if (char) {
          await db.collection<User>("users").updateOne(
            { _id: user._id },
            {
              $set: {
                activeCharacterId: char._id,
                activeCharacterCount: 1,
                updatedAt: now,
              },
            }
          );
          fixedActiveCharacterIds++;
        }
      } else {
        // B: Check if activeCharacterId points to valid character owned by this user
        const charIdStr = user.activeCharacterId.toString();
        const pointedChar = charById.get(charIdStr);
        if (!pointedChar || pointedChar.userId.toString() !== userId) {
          // Try to find the real character by userId
          const realChar = charByUserId.get(userId);
          if (realChar) {
            await db.collection<User>("users").updateOne(
              { _id: user._id },
              {
                $set: {
                  activeCharacterId: realChar._id,
                  activeCharacterCount: 1,
                  updatedAt: now,
                },
              }
            );
          } else {
            // No character at all — clear the stale reference
            await db.collection<User>("users").updateOne(
              { _id: user._id },
              {
                $set: {
                  activeCharacterId: null as unknown as ObjectId,
                  activeCharacterCount: 0,
                  updatedAt: now,
                },
              }
            );
          }
          fixedBrokenLinks++;
        }
      }
    }

    // C: Backfill countryId on characters from state
    const charsMissingCountryId = allChars.filter((c) => !c.countryId);
    let fixedCharacterCountryIds = 0;

    if (charsMissingCountryId.length > 0) {
      const stateIds = [...new Set(charsMissingCountryId.map((c) => c.homeState))];
      const states = await db
        .collection<State>("states")
        .find({ _id: { $in: stateIds } })
        .toArray();

      const stateCountryMap = new Map<string, (typeof states)[0]["countryId"]>();
      for (const s of states) {
        stateCountryMap.set(s._id as string, s.countryId);
      }

      for (const char of charsMissingCountryId) {
        const countryId = stateCountryMap.get(char.homeState);
        if (countryId) {
          await db
            .collection<Character>("characters")
            .updateOne(
              { _id: char._id },
              { $set: { countryId: countryId as CountryId, updatedAt: now } }
            );
          fixedCharacterCountryIds++;
        } else {
          console.warn(
            `[heal/discord-users] No state found for character ${char._id} homeState=${char.homeState}`
          );
        }
      }
    }

    const totalFixed = fixedActiveCharacterIds + fixedBrokenLinks + fixedCharacterCountryIds;

    return NextResponse.json({
      success: true,
      message:
        totalFixed === 0
          ? "No issues found — nothing to fix."
          : `Fixed ${totalFixed} issue(s): ${fixedActiveCharacterIds} missing activeCharacterId, ${fixedBrokenLinks} broken links, ${fixedCharacterCountryIds} characters missing countryId.`,
      fixedActiveCharacterIds,
      fixedBrokenLinks,
      fixedCharacterCountryIds,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
