import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug, listCaucusMemberships } from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character, NPP } from "@/lib/db/types";

type MemberFilter = "all" | "players" | "npps";

// GET /api/country/[code]/parties/[id]/caucuses/[slug]/roster — Caucus roster, optionally filtered by Players / NPPs
// Auth: requireAuth
// Errors: 400, 401, 404
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string }> }
) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const filterParam = new URL(request.url).searchParams.get("filter");
    const filter: MemberFilter =
      filterParam === "players" || filterParam === "npps" ? filterParam : "all";

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyId = String(party.sequentialId);

    const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
    if (!resolved) {
      return NextResponse.json({ error: "Caucus not found" }, { status: 404 });
    }
    const { caucus, isRedirect } = resolved;

    const memberType = filter === "players" ? "character" : filter === "npps" ? "npp" : undefined;
    const memberships = await listCaucusMemberships(db, caucus._id, memberType);

    const characterIds = memberships
      .filter((m) => m.memberType === "character")
      .map((m) => m.memberId);
    const nppIds = memberships.filter((m) => m.memberType === "npp").map((m) => m.memberId);

    const [characters, npps] = await Promise.all([
      characterIds.length
        ? db
            .collection<Character>("characters")
            .find(
              { _id: { $in: characterIds } },
              {
                projection: {
                  _id: 1,
                  name: 1,
                  avatarUrl: 1,
                  homeState: 1,
                  currentOffice: 1,
                  party: 1,
                  sequentialId: 1,
                },
              }
            )
            .toArray()
        : Promise.resolve([] as Character[]),
      nppIds.length
        ? db
            .collection<NPP>("npps")
            .find(
              // Exclude retired NPPs from caucus rosters — they no longer hold office or vote.
              { _id: { $in: nppIds }, retiredAt: null },
              {
                projection: {
                  _id: 1,
                  name: 1,
                  avatarUrl: 1,
                  homeState: 1,
                  currentOffice: 1,
                  party: 1,
                  sequentialId: 1,
                  personality: 1,
                },
              }
            )
            .toArray()
        : Promise.resolve([] as NPP[]),
    ]);

    const charById = new Map(characters.map((c) => [c._id.toString(), c]));
    const nppById = new Map(npps.map((n) => [n._id.toString(), n]));

    const items = memberships
      .map((m) => {
        if (m.memberType === "character") {
          const ch = charById.get(m.memberId.toString());
          if (!ch) return null;
          return {
            membershipId: m._id.toString(),
            memberType: "character" as const,
            memberId: ch._id.toString(),
            sequentialId: ch.sequentialId ?? null,
            name: ch.name,
            avatarUrl: ch.avatarUrl ?? null,
            homeState: ch.homeState,
            currentOffice: ch.currentOffice ?? null,
            party: ch.party ?? null,
            role: m.role,
            joinedAt: m.joinedAt?.toISOString() ?? null,
            complianceScore: m.complianceScore,
            loyalty: null,
          };
        }
        const npp = nppById.get(m.memberId.toString());
        // npp can be missing here if the membership references a retired NPP —
        // the projection filters out retiredAt != null. Drop them silently.
        if (!npp) return null;
        return {
          membershipId: m._id.toString(),
          memberType: "npp" as const,
          memberId: npp._id.toString(),
          sequentialId: npp.sequentialId ?? null,
          name: npp.name,
          avatarUrl: npp.avatarUrl ?? null,
          homeState: npp.homeState,
          currentOffice: npp.currentOffice ?? null,
          party: npp.party ?? null,
          role: m.role,
          joinedAt: m.joinedAt?.toISOString() ?? null,
          complianceScore: m.complianceScore,
          loyalty: npp.personality?.loyalty ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return NextResponse.json({
      caucusId: caucus._id.toString(),
      requestedSlug: slug,
      canonicalSlug: caucus.slug,
      isRedirect,
      filter,
      total: items.length,
      items,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
