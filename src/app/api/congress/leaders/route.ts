/**
 * GET  /api/congress/leaders  — list all Congress leadership roles and current holders
 * POST /api/congress/leaders  — admin: assign or clear a role (body: { role, characterId? })
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getPartyMap } from "@/lib/db/partyMap";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getAuthUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { leadersAssignSchema } from "@/lib/api/schemas/congress";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { getSenateComposition } from "@/lib/congress/senateComposition";
import { getPartyHex } from "@/lib/utils/politics";
import { LEADERSHIP_ROLES } from "@/lib/congress/leadershipRoles";
import { refreshStaleCongressLeaderParties } from "@/lib/congress/leadershipElections";
import type { CongressLeader, Character, NPP } from "@/lib/db/types";
import type { LeadershipRole } from "@/lib/db/types";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { getEnabledCountryIds } from "@/lib/countryAccess";

export interface LeaderDisplay {
  role: LeadershipRole;
  label: string;
  chamber: "house" | "senate";
  characterId: string | null;
  /** Sequential ID for stable URLs (prefer this over characterId) */
  sequentialId: number | null;
  characterName: string;
  party: string | null;
  partyName: string;
  partyColor: string;
  /** State abbreviation for (D-TX) style display */
  state?: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  isVacant: boolean;
  isNPP?: boolean;
}

export interface CongressLeadersResponse {
  leaders: LeaderDisplay[];
  isAdmin: boolean;
}

// GET /api/congress/leaders — Returns all Congress leadership roles and their current holders.
// Auth: public
// Errors: 400
export async function GET() {
  try {
    const db = await getDb();
    const partyMap = await getPartyMap(db, "US");
    const authUser = await getAuthUser().catch(() => null);
    const isAdmin = authUser?.isAdmin === true;
    const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();

    // congressLeaders is US-only; return empty if US is not enabled for players
    if (enabledCountries && !enabledCountries.includes("US")) {
      return NextResponse.json({ leaders: [], isAdmin } satisfies CongressLeadersResponse);
    }

    // Lazy self-heal (#1251): refresh party snapshots that no longer match the
    // holder's live party before rendering.
    await refreshStaleCongressLeaderParties(
      db,
      LEADERSHIP_ROLES.map((r) => r.role)
    );

    const docs = await db.collection<CongressLeader>("congressLeaders").find({}).toArray();
    const byRole = new Map(docs.map((d) => [d.role, d]));

    const leaderIds = docs.filter((d) => d.characterId).map((d) => d.characterId!);
    const characters = leaderIds.length
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: leaderIds } })
          .project({ _id: 1, avatarUrl: 1, homeState: 1, sequentialId: 1, userId: 1 })
          .toArray()
      : [];
    const avatarMap = new Map(characters.map((c) => [c._id.toString(), c.avatarUrl]));
    const stateMap = new Map(characters.map((c) => [c._id.toString(), c.homeState]));
    const seqIdMap = new Map(characters.map((c) => [c._id.toString(), c.sequentialId]));
    const charUserIdMap = new Map(
      characters.filter((c) => c.userId).map((c) => [c._id.toString(), c.userId])
    );
    const borderMap = await fetchBordersByUserIds(
      db,
      characters.filter((c) => c.userId).map((c) => c.userId)
    );

    // Fill state, avatar, and sequentialId for NPPs (character lookup returns nothing for NPP ids)
    const nppIdSet = new Set<string>();
    if (leaderIds.length > 0) {
      const charIds = new Set(characters.map((c) => c._id.toString()));
      const nppIds = leaderIds.filter((id) => !charIds.has(id.toString()));
      if (nppIds.length > 0) {
        const npps = await db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .project({ _id: 1, homeState: 1, avatarUrl: 1, sequentialId: 1 })
          .toArray();
        for (const npp of npps) {
          const nppIdStr = npp._id.toString();
          nppIdSet.add(nppIdStr);
          stateMap.set(nppIdStr, npp.homeState);
          avatarMap.set(nppIdStr, npp.avatarUrl);
          seqIdMap.set(nppIdStr, npp.sequentialId);
        }
      }
    }

    const leaders: LeaderDisplay[] = LEADERSHIP_ROLES.map(({ role, label, chamber }) => {
      const doc = byRole.get(role);
      const vacant = !doc?.characterId;
      const party = doc?.party ?? null;
      const p = party ? partyMap.get(party) : null;
      const charIdStr = doc?.characterId?.toString();
      const state = charIdStr ? stateMap.get(charIdStr) : undefined;
      const isNPP = charIdStr ? nppIdSet.has(charIdStr) : false;
      return {
        role,
        label,
        chamber,
        characterId: charIdStr ?? null,
        sequentialId: charIdStr ? (seqIdMap.get(charIdStr) ?? null) : null,
        characterName: doc?.characterName ?? "Vacant",
        party,
        partyName: p?.name ?? (party === "independent" ? "Independent" : (party ?? "—")),
        partyColor: getPartyHex(party ?? "", p?.color),
        state,
        avatarUrl: charIdStr ? avatarMap.get(charIdStr) : undefined,
        borderKey: charIdStr
          ? (borderMap.get(charUserIdMap.get(charIdStr)?.toString() ?? "")?.borderKey ?? null)
          : null,
        tintColor: charIdStr
          ? (borderMap.get(charUserIdMap.get(charIdStr)?.toString() ?? "")?.tintColor ?? null)
          : null,
        isVacant: vacant,
        isNPP,
      };
    });

    return NextResponse.json({ leaders, isAdmin } satisfies CongressLeadersResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/congress/leaders — Admin-only: assigns or clears a Congress leadership role.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const rateLimit = checkRateLimit(authUser.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!authUser.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const parsed = await parseJsonBody(request, leadersAssignSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { role, characterId } = parsed.data;
    const roleKey = role;
    const roleConfig = LEADERSHIP_ROLES.find((entry) => entry.role === roleKey);

    const db = await getDb();
    const now = new Date();

    if (!characterId || characterId.trim() === "") {
      await db.collection<CongressLeader>("congressLeaders").updateOne(
        { role: roleKey },
        {
          $set: {
            characterId: null,
            characterName: "Vacant",
            party: undefined,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
      return NextResponse.json({ message: `Role ${role} cleared.` });
    }

    if (!ObjectId.isValid(characterId)) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }
    const char = await db
      .collection<Character>("characters")
      .findOne({ _id: new ObjectId(characterId) }, { projection: { name: 1, party: 1 } });
    if (!char) return NextResponse.json({ error: "Character not found" }, { status: 404 });
    if (!roleConfig) {
      return NextResponse.json({ error: "Unknown leadership role" }, { status: 400 });
    }

    const holdsChamberSeat = await db.collection("electedOfficials").findOne({
      characterId: char._id,
      officeType: roleConfig.chamber,
    });
    if (!holdsChamberSeat) {
      return NextResponse.json(
        {
          error: `Only current ${roleConfig.chamber === "house" ? "House members" : "Senators"} may hold this role.`,
        },
        { status: 403 }
      );
    }

    if (roleKey === "majority_leader_house" || roleKey === "majority_leader_senate") {
      const partyMap = await getPartyMap(db, "US");
      const majorityParty =
        roleKey === "majority_leader_house"
          ? (await getHouseComposition(db, partyMap)).majorityParty
          : (await getSenateComposition(db, partyMap)).majorityParty;
      if (!majorityParty || char.party !== majorityParty) {
        return NextResponse.json(
          { error: "Only the chamber's current majority party may hold this role." },
          { status: 403 }
        );
      }
    }

    await db.collection<CongressLeader>("congressLeaders").updateOne(
      { role: roleKey },
      {
        $set: {
          role: roleKey,
          characterId: char._id,
          characterName: char.name,
          party: char.party ?? undefined,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    const { markCongressLeadershipHeld } = await import("@/lib/wiki/markCongressLeadership");
    markCongressLeadershipHeld(db, characterId, now).catch((err) =>
      console.error("[Leaders] Failed to mark congress leadership:", err)
    );

    return NextResponse.json({ message: `${char.name} assigned to ${role}.` });
  } catch (error) {
    return handleRouteError(error);
  }
}
