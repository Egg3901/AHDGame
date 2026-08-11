import type { Db, Filter } from "mongodb";
import { ObjectId } from "mongodb";
import type { ElectedOfficial, PoliticalParty, Character } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS, isParliamentarySystemForGovernmentType } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { buildCharacterHref } from "@/lib/utils/profileUrls";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

export async function queryGovernment(db: Db, country: string) {
  const countryConfig = COUNTRY_CONFIGS[country as CountryId];
  if (!countryConfig) return null;

  // Public API exposes runtime governmentType so a post-Stage-4 country
  // shows its new regime; isParliamentary gating follows the same runtime
  // value so the response shape (parliamentary vs presidential payload)
  // matches the regime the user is actually looking at.
  const runtime = await getCountryState(db, country as CountryId);
  const isParliamentary = isParliamentarySystemForGovernmentType(runtime.governmentType);

  const [executives, leaders, cabinetMembers] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: country,
        officeType: {
          $in: [
            "president",
            "vicePresident",
            "primeMinister",
            "chancellor",
            "taoiseach",
            "uachtaran",
          ],
        },
      } as Filter<ElectedOfficial>)
      .toArray(),
    db.collection("congressLeaders").find({ countryId: country }).toArray(),
    db.collection("cabinetMembers").find({ countryId: country }).toArray(),
  ]);

  // Collect character IDs for profile URL lookups
  const charIds = new Set<string>();
  for (const e of executives) {
    if (e.characterId) charIds.add(e.characterId.toString());
  }
  for (const l of leaders) {
    if ((l as Record<string, unknown>).characterId) {
      charIds.add(
        ((l as Record<string, unknown>).characterId as { toString(): string }).toString()
      );
    }
  }
  for (const c of cabinetMembers) {
    if ((c as Record<string, unknown>).characterId) {
      charIds.add(
        ((c as Record<string, unknown>).characterId as { toString(): string }).toString()
      );
    }
  }

  const charObjectIds = [...charIds]
    .map((id) => {
      try {
        return new ObjectId(id);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as ObjectId[];

  const characters =
    charObjectIds.length > 0
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: charObjectIds } })
          .project<Pick<Character, "_id" | "sequentialId" | "party" | "countryId" | "avatarUrl">>({
            _id: 1,
            sequentialId: 1,
            party: 1,
            countryId: 1,
          })
          .toArray()
      : [];
  const charMap = new Map(characters.map((c) => [c._id.toString(), c]));

  // Collect party refs for bulk lookup
  const allPartyRefs = new Set<string>();
  for (const e of executives) {
    if (e.party && e.party !== "independent") allPartyRefs.add(e.party);
  }
  for (const l of leaders) {
    const p = (l as Record<string, unknown>).party as string | undefined;
    if (p && p !== "independent") allPartyRefs.add(p);
  }
  for (const c of cabinetMembers) {
    const p = (c as Record<string, unknown>).party as string | undefined;
    if (p && p !== "independent") allPartyRefs.add(p);
  }

  const partyLookups = [...allPartyRefs]
    .map(Number)
    .filter(Boolean)
    .map((seqId) => ({ countryId: country as CountryId, sequentialId: seqId }));

  const parties =
    partyLookups.length > 0
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({
            $or: partyLookups.map((l) => ({
              countryId: l.countryId,
              sequentialId: l.sequentialId,
            })),
          })
          .toArray()
      : [];
  const partyMap = new Map(parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p]));

  function resolveParty(partyRef: string | undefined): { name: string | null; color: string } {
    if (!partyRef || partyRef === "independent") {
      return { name: partyRef === "independent" ? "Independent" : null, color: "#666666" };
    }
    const party = partyMap.get(`${country}:${partyRef}`);
    return { name: party?.name ?? null, color: party?.color ?? "#666666" };
  }

  function buildProfileUrl(charId: string | null): string | null {
    if (!charId) return null;
    const char = charMap.get(charId);
    return char ? `${BASE_URL}${buildCharacterHref(char)}` : `${BASE_URL}/character/${charId}`;
  }

  const officials = [
    ...executives.map((e) => {
      const charIdStr = e.characterId?.toString() ?? null;
      const pInfo = resolveParty(e.party);
      return {
        role: e.officeType,
        section: "executive" as const,
        characterId: charIdStr,
        characterName: e.characterName ?? null,
        party: pInfo.name,
        partyColor: pInfo.color,
        profileUrl: buildProfileUrl(charIdStr),
        isNPP: e.isNPP ?? false,
      };
    }),
    ...(leaders as Array<Record<string, unknown>>).map((l) => {
      const charIdStr = (l.characterId as { toString(): string } | undefined)?.toString() ?? null;
      const pInfo = resolveParty(l.party as string | undefined);
      return {
        role: (l.role as string) ?? null,
        section: "leadership" as const,
        characterId: charIdStr,
        characterName: (l.characterName as string) ?? null,
        party: pInfo.name,
        partyColor: pInfo.color,
        profileUrl: buildProfileUrl(charIdStr),
        isNPP: (l.isNPP as boolean) ?? false,
      };
    }),
  ];

  const cabinet = (cabinetMembers as Array<Record<string, unknown>>).map((c) => {
    const charIdStr = (c.characterId as { toString(): string } | undefined)?.toString() ?? null;
    const pInfo = resolveParty(c.party as string | undefined);
    return {
      role: (c.role as string) ?? null,
      characterName: (c.characterName as string) ?? null,
      party: pInfo.name,
      partyColor: pInfo.color,
      profileUrl: buildProfileUrl(charIdStr),
      isNPP: (c.isNPP as boolean) ?? false,
    };
  });

  // Government formation
  const gfCollection = getGovernmentFormationsCollection(db);
  const gfDoc = await gfCollection.findOne({ countryId: country as CountryId });

  let governmentFormation: Record<string, unknown>;

  if (isParliamentary && gfDoc) {
    const partySeqIds = Object.keys(gfDoc.seatsByParty ?? {})
      .map(Number)
      .filter(Boolean);
    const partyDocs =
      partySeqIds.length > 0
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .find({
              sequentialId: { $in: partySeqIds },
              countryId: country,
            } as Filter<PoliticalParty>)
            .toArray()
        : [];
    const gfPartyMap = new Map(partyDocs.map((p) => [String(p.sequentialId), p]));

    const seatsByParty = Object.entries(gfDoc.seatsByParty ?? {})
      .map(([seqId, seats]) => {
        const p = gfPartyMap.get(seqId);
        return {
          partyId: p?._id?.toString() ?? seqId,
          partyName: p?.name ?? seqId,
          partyColor: p?.color ?? "#666666",
          seats,
        };
      })
      .sort((a, b) => b.seats - a.seats);

    governmentFormation = {
      type: runtime.governmentType,
      status: gfDoc.status,
      formationType: gfDoc.formationType,
      pmCharacterId: gfDoc.pmCharacterId?.toString() ?? null,
      pmName: gfDoc.pmName ?? null,
      governingPartyId: gfDoc.governingPartyId ?? null,
      governingPartyName:
        ((gfDoc as unknown as Record<string, unknown>).governingPartyName as string | null) ?? null,
      coalitionPartyIds: gfDoc.coalitionPartyIds ?? null,
      coalitionPartyNames:
        ((gfDoc as unknown as Record<string, unknown>).coalitionPartyNames as string[] | null) ??
        null,
      totalSeatsSupporting: gfDoc.totalSeatsSupporting ?? 0,
      majorityThreshold: gfDoc.majorityThreshold ?? 0,
      totalSeats: gfDoc.totalSeats ?? 0,
      seatsByParty,
    };
  } else {
    const president = executives[0] ?? null;
    governmentFormation = {
      type: runtime.governmentType,
      president: president
        ? {
            name: president.characterName ?? null,
            party: resolveParty(president.party).name,
            profileUrl: buildProfileUrl(president.characterId?.toString() ?? null),
          }
        : null,
    };
  }

  return {
    found: true,
    country,
    countryName: countryConfig.name,
    officials,
    cabinet,
    governmentFormation,
  };
}
