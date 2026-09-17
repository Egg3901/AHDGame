import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import type { User, PoliticalParty } from "@/lib/db/types";
import { eligibleIdentitySignals } from "@/lib/auth/identitySignals";
import { loadRecentIdentityValues } from "@/lib/identityHistory/recentValues";
import { hashSensitiveSignal } from "@/lib/utils/hashSignal";

/** Hash a list of identity values, dropping any that hash to null. The client
 * grouper matches on these hashes, so a hash of one value must equal a hash of
 * the same value anywhere else on this route — which it does, same function. */
function hashSignalList(values: string[] | undefined): string[] {
  return (values ?? []).map(hashSensitiveSignal).filter((value): value is string => value !== null);
}

// GET /api/moderator/users — List all non-admin users.
// Auth: requireModerator
// Errors: 403
export async function GET() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Exclude admin accounts — moderators cannot see or affect admins
    const users = await db
      .collection<User>("users")
      .find({ role: { $ne: "admin" } })
      .toArray();

    const characters = await db.collection("characters").find({}).toArray();
    const charByUser = new Map(characters.map((c) => [c.userId.toString(), c]));

    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({}, { projection: { sequentialId: 1, countryId: 1, name: 1 } })
      .toArray();
    const partyNameMap = new Map<string, string>(
      parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p.name])
    );

    // One instant for the whole list so every row is judged against the same
    // cutoff boundary — both the scalar eligibility below and the identity
    // history window.
    const now = new Date();

    const recentIdentity = await loadRecentIdentityValues(
      db,
      users.map((u) => u._id),
      now
    );

    return NextResponse.json({
      users: users.map((u) => {
        const char = charByUser.get(u._id.toString());
        const rawParty = char?.party ?? null;
        const numericParty = rawParty ? parseInt(rawParty, 10) : NaN;
        const resolvedParty =
          !isNaN(numericParty) && char?.countryId
            ? (partyNameMap.get(`${char.countryId}:${numericParty}`) ?? rawParty)
            : rawParty;
        return {
          id: u._id.toString(),
          username: u.username,
          email: u.email,
          role: u.role,
          isAdmin: false,
          isBanned: u.isBanned ?? false,
          characterId: char?._id?.toString() ?? null,
          characterName: char?.name ?? null,
          party: resolvedParty,
          registrationIp: null,
          lastKnownIp: null,
          registrationIpKey: hashSensitiveSignal(u.registrationIp),
          lastKnownIpKey: hashSensitiveSignal(u.lastKnownIp),
          lastAuthToken: null,
          registrationFingerprint: null,
          lastFingerprint: null,
          registrationFingerprintKey: hashSensitiveSignal(u.registrationFingerprint),
          lastFingerprintKey: hashSensitiveSignal(u.lastFingerprint),
          fingerprintCount: u.fingerprintHistory?.length ?? 0,
          // Hashed, exactly like every other signal on this route. The raw
          // arrays stay null so a moderator bundle has no path to a real IP.
          historicalIps: null,
          historicalFingerprints: null,
          historicalIpKeys: hashSignalList(recentIdentity.get(u._id.toString())?.ips),
          historicalFingerprintKeys: hashSignalList(
            recentIdentity.get(u._id.toString())?.fingerprints
          ),
          trackingId: null,
          trackingIdKey: hashSensitiveSignal(u.trackingId),
          deviceKey: null,
          deviceKeyKey: hashSensitiveSignal(u.deviceKey),
          lastDevice: u.lastDevice ?? null,
          lastLogin: u.lastLogin?.toISOString() ?? null,
          lastLogout: u.lastLogout?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
          discordId: null,
          discordUsername: u.discordUsername ?? null,
          modNote: u.modNote ?? null,
          latestModNote: u.modNotes?.at(-1)?.text ?? u.modNote ?? null,
          vpnFlag: u.ipDetails ? u.ipDetails.isVpn || u.ipDetails.isProxy : null,
          // Computed from the RAW user document, deliberately: every signal
          // above is emitted to moderators as a sha256 hash, and a hash never
          // equals "unknown" nor falls inside a Cloudflare CIDR. Deferring
          // these checks to the client is what let every account with an
          // unresolvable IP get welded into a single duplicate group.
          signalEligibility: eligibleIdentitySignals(u, now),
        };
      }),
      total: users.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
