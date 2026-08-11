/**
 * GET /api/country/[code]/legislature/members — National legislature members by country.
 *
 * Consolidates the former per-country routes:
 *   /api/legislature/uk/members, /api/legislature/ca/members, /api/legislature/de/members
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getLiveLowerChamberSeats, getLiveUpperChamberSeats } from "@/lib/turn/lowerChamberSeats";
import type { PoliticalParty, ElectedOfficial, State, Character, NPP } from "@/lib/db/types";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const db = await getDb();
    const { searchParams } = new URL(request.url);

    const lowerKey = config.legislature.lowerChamber.key;
    const chamber = searchParams.get("chamber") ?? lowerKey;

    // Handle appointed upper chambers (CA senate, DE bundesrat, UK lords) — return empty
    const upperChamber = config.legislature.upperChamber;
    if (upperChamber && chamber === upperChamber.key && !upperChamber.elected) {
      // Size is still LIVE for region-apportioned upper chambers (IE Seanad grows
      // 60 → 84 when NI joins); static config for the rest.
      const upperSeats = await getLiveUpperChamberSeats(db, countryId);
      return NextResponse.json({
        totalSeats: upperSeats,
        filledSeats: 0,
        vacantSeats: upperSeats,
        composition: [],
        members: [],
      });
    }

    const isUpperChamber = upperChamber && chamber === upperChamber.key;
    // Chamber size is the LIVE region sum (SSOT), so a region transfer that
    // grows/shrinks it (NI joining the Dáil/Seanad) is reflected — not the static
    // config seed. Matches the turn's majority math.
    const totalSeats = isUpperChamber
      ? await getLiveUpperChamberSeats(db, countryId)
      : await getLiveLowerChamberSeats(db, countryId);

    // Query elected officials for the requested chamber — resolve chamber key to office type
    // (e.g. CN "npc" → "npcDelegate")
    const resolvedOfficeType = getOfficeTypeForChamber(countryId, chamber);
    const officialFilter: Record<string, unknown> = { officeType: resolvedOfficeType, countryId };

    const allOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find(officialFilter)
      .toArray();
    const officials = allOfficials.filter(
      (o) =>
        (o.characterId != null || o.nppId != null) &&
        o.characterName &&
        o.characterName !== "Unknown"
    );

    const filledSeats = officials.reduce((sum, o) => sum + (o.seatsHeld ?? 1), 0);
    const vacantSeats = totalSeats - filledSeats;

    // Calculate party composition
    const partySeats = new Map<string, number>();
    for (const o of officials) {
      const party = o.party || "independent";
      partySeats.set(party, (partySeats.get(party) || 0) + (o.seatsHeld ?? 1));
    }

    // Get party details — filter by countryId to avoid cross-country collisions
    const partySeqIds = Array.from(partySeats.keys()).map(Number).filter(Boolean);
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ sequentialId: { $in: partySeqIds }, countryId })
      .toArray();

    const partyMap = new Map<string, PoliticalParty>(
      parties.map((p) => [String(p.sequentialId), p])
    );

    const composition = Array.from(partySeats.entries())
      .map(([partyId, seats]) => {
        const party = partyMap.get(partyId);
        return {
          partyId,
          partyName: party?.name || (partyId === "independent" ? "Independent" : partyId),
          partyColor: party?.color || "#888888",
          economicPosition: party?.economicPosition ?? 0,
          seats,
        };
      })
      .sort((a, b) => b.seats - a.seats);

    // Look up region display names for all member states
    const memberStateIds = [...new Set(officials.map((o) => o.state).filter(Boolean))];
    const stateDocs = await db
      .collection<State>("states")
      .find({ _id: { $in: memberStateIds as string[] } }, { projection: { name: 1 } })
      .toArray();
    const stateNameMap = new Map(stateDocs.map((s) => [s._id as string, s.name]));

    // Batch-fetch avatarUrls for players and NPPs
    const playerIds = officials
      .filter((o) => !o.isNPP && o.characterId)
      .map((o) => o.characterId as ObjectId);
    const nppIds = officials
      .filter((o) => (o.isNPP ?? !o.characterId) && o.nppId)
      .map((o) => o.nppId as ObjectId);

    const [playerDocs, nppDocs] = await Promise.all([
      playerIds.length > 0
        ? db
            .collection<Character>("characters")
            .find(
              { _id: { $in: playerIds } },
              { projection: { _id: 1, avatarUrl: 1, sequentialId: 1 } }
            )
            .toArray()
        : [],
      nppIds.length > 0
        ? db
            .collection<NPP>("npps")
            .find(
              { _id: { $in: nppIds } },
              { projection: { _id: 1, avatarUrl: 1, sequentialId: 1 } }
            )
            .toArray()
        : [],
    ]);

    const playerDataMap = new Map(
      (playerDocs as { _id: ObjectId; avatarUrl?: string; sequentialId?: number }[]).map((c) => [
        c._id.toString(),
        { avatarUrl: c.avatarUrl ?? null, sequentialId: c.sequentialId ?? null },
      ])
    );
    const nppDataMap = new Map(
      (nppDocs as { _id: ObjectId; avatarUrl?: string; sequentialId?: number }[]).map((n) => [
        n._id.toString(),
        { avatarUrl: n.avatarUrl ?? null, sequentialId: n.sequentialId ?? null },
      ])
    );

    // Build member list
    const members = officials
      .map((o) => {
        const party = partyMap.get(o.party || "");
        const isNPP = o.isNPP ?? !o.characterId;
        const data = isNPP
          ? nppDataMap.get(o.nppId?.toString() ?? "")
          : playerDataMap.get(o.characterId?.toString() ?? "");
        return {
          characterId: o.characterId?.toString() ?? o.nppId?.toString() ?? "",
          sequentialId: data?.sequentialId ?? null,
          characterName: o.characterName || "Unknown",
          constituency: o.constituency ?? stateNameMap.get(o.state ?? "") ?? o.state ?? "Unknown",
          constituencyId: o.constituencyId ?? null,
          region: stateNameMap.get(o.state ?? "") ?? o.state ?? "Unknown",
          party: o.party || "independent",
          partyName: party?.name || "Independent",
          partyColor: party?.color || "#888888",
          isNPP,
          seatsHeld: o.seatsHeld ?? 1,
          avatarUrl: data?.avatarUrl ?? null,
        };
      })
      // Players first, then NPPs, each sorted by name
      .sort((a, b) => {
        if (a.isNPP !== b.isNPP) return a.isNPP ? 1 : -1;
        return a.characterName.localeCompare(b.characterName);
      });

    return NextResponse.json({
      totalSeats,
      filledSeats,
      vacantSeats,
      composition,
      members,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
