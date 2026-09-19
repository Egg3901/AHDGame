import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { parseBoundedIntParam } from "@/lib/api/validate";
import type { User, Character, PoliticalParty } from "@/lib/db/types";
import {
  eligibleIdentitySignals,
  type IdentitySignalEligibility,
} from "@/lib/auth/identitySignals";

export interface UserWithCharacter {
  id: string;
  username: string;
  email: string;
  role: string;
  isAdmin: boolean;
  isBanned: boolean;
  singleplayerEntitled: boolean;
  characterId: string | null;
  characterName: string | null;
  party: string | null;
  registrationIp: string | null;
  lastKnownIp: string | null;
  lastAuthToken: string | null;
  registrationFingerprint: string | null;
  lastFingerprint: string | null;
  fingerprintCount: number;
  trackingId: string | null;
  deviceKey: string | null;
  lastDevice: "mobile" | "tablet" | "desktop" | null;
  lastLogin: string | null;
  lastLogout: string | null;
  createdAt: string;
  discordId: string | null;
  discordUsername: string | null;
  modNote: string | null;
  latestModNote: string | null;
  ipDetails?: User["ipDetails"] | null;
  /** Per-signal matching eligibility. Consumed only by the duplicate-group
   * builder; the users table renders the raw values above unchanged. */
  signalEligibility: IdentitySignalEligibility;
}

// GET /api/admin/users — List users (newest first) with their associated character data.
// Auth: requireAdmin
// Query: ?limit (default 500, max 2000), ?offset (default 0)
// Errors: 403
export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseBoundedIntParam(searchParams, "limit", 500, 1, 2000);
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

    const db = await getDb();

    // Fetch users sorted by creation date (newest first), bounded by limit/offset.
    const [users, total] = await Promise.all([
      db
        .collection<User>("users")
        .find({})
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection<User>("users").countDocuments(),
    ]);

    // Fetch only the characters for users in this page (avoids loading the
    // entire characters collection on busy servers).
    const characters = await db
      .collection<Character>("characters")
      .find({ userId: { $in: users.map((u) => u._id) } })
      .toArray();

    // Create a map of userId to character for quick lookup
    const characterMap = new Map<string, Character>();
    for (const char of characters) {
      characterMap.set(char.userId.toString(), char);
    }

    // Build party name lookup: "countryId:sequentialId" → party name
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({}, { projection: { sequentialId: 1, countryId: 1, name: 1 } })
      .toArray();
    const partyNameMap = new Map<string, string>(
      parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p.name])
    );

    function resolvePartyName(char: Character | undefined): string | null {
      if (!char?.party) return null;
      const numeric = parseInt(char.party, 10);
      if (!isNaN(numeric) && char.countryId) {
        return partyNameMap.get(`${char.countryId}:${numeric}`) ?? char.party;
      }
      return char.party;
    }

    // One instant for the whole page so every row is judged against the same
    // cutoff boundary.
    const now = new Date();

    // Combine user and character data
    const usersWithCharacters: UserWithCharacter[] = users.map((user) => {
      const character = characterMap.get(user._id.toString());
      return {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role,
        isAdmin: user.isAdmin || false,
        isBanned: user.isBanned || false,
        singleplayerEntitled: Boolean(user.singleplayerEntitledAt),
        characterId: character?._id?.toString() || null,
        characterName: character?.name || null,
        party: resolvePartyName(character),
        registrationIp: user.registrationIp || null,
        lastKnownIp: user.lastKnownIp || null,
        lastAuthToken: user.lastAuthToken || null,
        registrationFingerprint: user.registrationFingerprint || null,
        lastFingerprint: user.lastFingerprint || null,
        fingerprintCount: user.fingerprintHistory?.length || 0,
        trackingId: user.trackingId || null,
        deviceKey: user.deviceKey || null,
        lastDevice: user.lastDevice ?? null,
        lastLogin: user.lastLogin?.toISOString() || null,
        lastLogout: user.lastLogout?.toISOString() || null,
        createdAt: user.createdAt.toISOString(),
        discordId: user.discordId || null,
        discordUsername: user.discordUsername || null,
        modNote: user.modNote || null,
        latestModNote: user.modNotes?.at(-1)?.text ?? user.modNote ?? null,
        ipDetails: user.ipDetails ?? null,
        // Annotation only — every value emitted above is unchanged. Nulling
        // ineligible signals here would blank the Registration IP / Last Known
        // IP columns in the users table for any account inactive 30+ days,
        // which is a forensic regression in a view this change does not touch.
        signalEligibility: eligibleIdentitySignals(user, now),
      };
    });

    return NextResponse.json({
      users: usersWithCharacters,
      total,
      limit,
      offset,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
