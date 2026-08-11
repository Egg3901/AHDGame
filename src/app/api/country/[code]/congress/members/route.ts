/**
 * GET /api/country/[code]/congress/members?chamber=senate|house
 *
 * Returns current ElectedOfficial records for the requested chamber.
 * Vacancies are DERIVED (totalSeats - filledSeats) — never read from DB rows.
 * Vacant ElectedOfficial rows in the DB are ignored entirely.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getPartyHex } from "@/lib/utils/politics";
import type { ElectedOfficial, PoliticalParty, Character, NPP } from "@/lib/db/types";
import { TOTAL_HOUSE_SEATS, TOTAL_SENATE_SEATS } from "@/lib/constants";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CongressMember, CongressMembersResponse } from "@/lib/congress/types";

// Re-export for any consumer that still imports types from the route file.
// New consumers should import from "@/lib/congress/types" directly.
export type { CongressMember, CongressMembersResponse } from "@/lib/congress/types";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const requestedCountry = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[requestedCountry]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const chamber = (searchParams.get("chamber") ?? "senate") as "senate" | "house";

    const db = await getDb();
    const officialFilter: Record<string, unknown> = { officeType: chamber };
    if (requestedCountry === COUNTRY_CONFIGS.US.id) {
      // Backward compatibility: legacy US rows may not have countryId populated.
      officialFilter.$or = [
        { countryId: COUNTRY_CONFIGS.US.id },
        { countryId: { $exists: false } },
      ];
    } else {
      officialFilter.countryId = requestedCountry;
    }

    const [officials, parties] = await Promise.all([
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find(officialFilter)
        .sort({ state: 1, senateClass: 1, district: 1 })
        .toArray(),
      db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId: requestedCountry })
        .toArray(),
    ]);

    // Only real (filled) seats — vacant DB rows are discarded here.
    const filledOfficials = officials.filter((o) => o.characterId != null || o.nppId != null);

    const charIds = filledOfficials.filter((o) => o.characterId).map((o) => o.characterId!);
    const nppIds = filledOfficials.filter((o) => o.nppId).map((o) => o.nppId!);

    const [charDocs, nppDocs] = await Promise.all([
      charIds.length > 0
        ? db
            .collection<Character>("characters")
            .find(
              { _id: { $in: charIds } },
              { projection: { _id: 1, avatarUrl: 1, sequentialId: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
      nppIds.length > 0
        ? db
            .collection<NPP>("npps")
            .find(
              { _id: { $in: nppIds } },
              { projection: { _id: 1, avatarUrl: 1, sequentialId: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
    ]);
    const avatarMap = new Map(charDocs.map((c) => [c._id.toString(), c.avatarUrl]));
    const seqIdMap = new Map(charDocs.map((c) => [c._id.toString(), c.sequentialId]));
    const nppAvatarMap = new Map(nppDocs.map((n) => [n._id.toString(), n.avatarUrl]));
    const nppSeqIdMap = new Map(nppDocs.map((n) => [n._id.toString(), n.sequentialId]));

    // Party lookup: by sequentialId first, then display name fallback for legacy records.
    const partyBySeqId = new Map(parties.map((p) => [String(p.sequentialId), p]));
    const partyByName = new Map(parties.map((p) => [p.name.toLowerCase(), p]));

    function resolveParty(raw: string | undefined) {
      if (!raw) return { partyId: "__vacant__", name: "Vacant", color: "#374151", econ: 0 };
      const p = partyBySeqId.get(raw) ?? partyByName.get(raw.toLowerCase());
      // Capitalize built-in party names as fallback
      const fallbackName =
        raw === "independent" ? "Independent" : raw.charAt(0).toUpperCase() + raw.slice(1);
      const partyId = p ? String(p.sequentialId) : raw;
      return {
        partyId,
        name: p?.name ?? fallbackName,
        color: getPartyHex(partyId, p?.color),
        econ: p?.economicPosition ?? 0,
      };
    }

    // Map filled officials → CongressMember, deduplicating by characterId/nppId.
    const seenChars = new Set<string>();
    const seenNpps = new Set<string>();
    const members: CongressMember[] = [];

    for (const o of filledOfficials) {
      if (o.characterId) {
        const key = o.characterId.toString();
        if (seenChars.has(key)) continue;
        seenChars.add(key);
      } else if (o.nppId) {
        const key = o.nppId.toString();
        if (seenNpps.has(key)) continue;
        seenNpps.add(key);
      }

      const resolved = resolveParty(o.party);

      const charIdStr = o.characterId?.toString();
      const nppIdStr = o.nppId?.toString();
      members.push({
        id: o._id.toString(),
        officeType: o.officeType as "senate" | "house",
        state: o.state ?? "",
        district: o.district,
        senateClass: o.senateClass,
        seatsHeld: o.seatsHeld ?? 1,
        characterId: charIdStr ?? nppIdStr ?? null,
        sequentialId: charIdStr
          ? (seqIdMap.get(charIdStr) ?? null)
          : nppIdStr
            ? (nppSeqIdMap.get(nppIdStr) ?? null)
            : null,
        characterName: o.characterName ?? "Unknown",
        avatarUrl: charIdStr
          ? (avatarMap.get(charIdStr) ?? undefined)
          : nppIdStr
            ? (nppAvatarMap.get(nppIdStr) ?? undefined)
            : undefined,
        party: resolved.partyId,
        partyName: resolved.name,
        partyColor: resolved.color,
        countryId: requestedCountry as "US" | "UK" | "DE",
        economicPosition: resolved.econ,
        isNPP: o.isNPP ?? false,
        isVacant: false,
        electedAt: o.electedAt?.toISOString(),
        termEnds: o.termEnds?.toISOString(),
      });
    }

    // Tally filled seats per party.
    const tallyMap = new Map<
      string,
      { partyName: string; partyColor: string; economicPosition: number; seats: number }
    >();
    for (const m of members) {
      const existing = tallyMap.get(m.party);
      if (existing) {
        existing.seats += m.seatsHeld;
      } else {
        tallyMap.set(m.party, {
          partyName: m.partyName,
          partyColor: m.partyColor,
          economicPosition: m.economicPosition,
          seats: m.seatsHeld,
        });
      }
    }

    // Derive vacancies from authoritative seat totals — never from DB rows.
    const totalSeats = chamber === "house" ? TOTAL_HOUSE_SEATS : TOTAL_SENATE_SEATS;
    const filledSeats = [...tallyMap.values()].reduce((s, v) => s + v.seats, 0);
    const vacantSeats = Math.max(0, totalSeats - filledSeats);

    if (vacantSeats > 0) {
      tallyMap.set("__vacant__", {
        partyName: "Vacant",
        partyColor: "#374151",
        economicPosition: 0,
        seats: vacantSeats,
      });
    }

    const composition = [...tallyMap.entries()]
      .map(([party, v]) => ({ party, ...v }))
      .sort((a, b) => {
        if (a.party === "__vacant__") return 1;
        if (b.party === "__vacant__") return -1;
        return a.economicPosition - b.economicPosition;
      });

    return NextResponse.json({
      members,
      composition,
      totalSeats,
      chamber,
    } satisfies CongressMembersResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}
