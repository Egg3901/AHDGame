/**
 * GET /api/country/[code]/executive/cabinet — Cabinet data by country.
 * Parliamentary countries: PM + cabinet positions with direct appointment.
 * US: proxies to whitehouse/cabinet logic (Senate confirmation flow).
 * Auth: optional (public view, PM sees appoint/fire buttons)
 * Errors: 404
 */
import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser()
import { handleRouteError } from "@/lib/api/errors";
import {
  COUNTRY_CONFIGS,
  type CountryId,
  isParliamentarySystemForGovernmentType,
} from "@/lib/constants/countries";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resolveCabinetRoster } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import { ObjectId } from "mongodb";
import { getUKCabinetCooldownsCollection } from "@/lib/db/collections/ukGovernment";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getGameTime } from "@/lib/time/gameTime";
import { getCountryState } from "@/lib/countryState";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) notFound();

    const config = COUNTRY_CONFIGS[countryId];

    // Parliamentary-family countries use direct PM appointment. Gate on the
    // RUNTIME government type so a regime conversion flips this API alongside
    // the executive page dispatch (which is also runtime-keyed).
    const db = await getDb();
    const runtime = await getCountryState(db, countryId);
    if (isParliamentarySystemForGovernmentType(runtime.governmentType)) {
      return await handleParliamentaryCabinet(countryId);
    }

    return NextResponse.json({
      countryId,
      supported: false,
      positions: [],
      message: `${config.name} cabinet page is coming soon.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function handleParliamentaryCabinet(countryId: CountryId) {
  const db = await getDb();
  const authUser = await getAuthUser().catch(() => null);

  // Runtime government type drives cabinet eligibility. One Party States may
  // appoint any player citizen (not just legislators), so the UI advertises
  // the relaxed rule. Reads runtime state so a Stage-4 conversion is reflected.
  const runtime = await getCountryState(db, countryId);
  const isOnePartyState = runtime.governmentType === "onePartyState";

  // Get PM from canonical governmentFormations
  const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  const pmCharId = govFormation?.pmCharacterId ?? null;

  const myCharacter = authUser
    ? await db
        .collection<Character>("characters")
        .findOne({ userId: new ObjectId(authUser.userId) })
    : null;
  const isPrimeMinister = !!pmCharId && !!myCharacter && pmCharId.equals(myCharacter._id);

  // Active-cooldown filter is turn-first (drift-immune, freezes on pause) with a
  // Date fallback for cooldowns not yet backfilled.
  const { currentTurn: cabinetTurn, effectiveNow: cabinetNow } = await getGameTime();

  // Get current cabinet members, cooldowns, and related lookups in parallel
  const [members, cooldowns, parties] = await Promise.all([
    getCabinetMembersCollection(db).find({ countryId }).toArray(),
    getUKCabinetCooldownsCollection(db)
      .find({
        countryId,
        $or: [
          { cooldownUntilTurn: { $gt: cabinetTurn } },
          { cooldownUntilTurn: { $exists: false }, cooldownUntil: { $gt: cabinetNow } },
        ],
      })
      .toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId })
      .project({ sequentialId: 1, name: 1, color: 1, logoUrl: 1 })
      .toArray(),
  ]);

  const memberMap = new Map(members.map((m) => [m.positionId, m]));
  const cooldownMap = new Map(cooldowns.map((c) => [c.positionId, c.cooldownUntil]));

  // Build party lookup by sequentialId string (member.party stores sequentialId as string)
  const partyBySeqId = new Map(parties.map((p) => [String(p.sequentialId), p]));

  // Look up character details (sequentialId, avatar, Patreon frame, party) for
  // all PLAYER cabinet members AND the sitting head of government (auto-filled
  // below). NPP-held seats carry a null characterId and have no character doc.
  const memberCharIds = members
    .map((m) => m.characterId)
    .filter((id): id is ObjectId => id != null);
  const charIdsToFetch = pmCharId ? [...memberCharIds, pmCharId] : memberCharIds;
  const characters =
    charIdsToFetch.length > 0
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: charIdsToFetch } })
          .project({ sequentialId: 1, avatarUrl: 1, borderKey: 1, tintColor: 1, party: 1 })
          .toArray()
      : [];
  const charDataMap = new Map(
    characters.map((c) => [
      c._id.toString(),
      {
        sequentialId: c.sequentialId,
        avatarUrl: c.avatarUrl,
        borderKey: c.borderKey,
        tintColor: c.tintColor,
        party: c.party,
      },
    ])
  );

  // The head-of-government seat (CN Premier, IE Taoiseach) is auto-assigned from
  // governmentFormations.pmCharacterId, not the cabinet appointment flow. Build
  // its display member from the sitting PM so the card is never wrongly empty.
  const pmCharData = pmCharId ? charDataMap.get(pmCharId.toString()) : undefined;
  const pmPartyId = pmCharData?.party ?? govFormation?.governingPartyId ?? undefined;
  const pmParty = pmPartyId ? partyBySeqId.get(String(pmPartyId)) : undefined;
  const headOfGovernmentMember =
    pmCharId && govFormation
      ? {
          characterId: pmCharId.toString(),
          sequentialId: pmCharData?.sequentialId ?? null,
          characterName: govFormation.pmName ?? "",
          avatarUrl: pmCharData?.avatarUrl ?? null,
          borderKey: pmCharData?.borderKey ?? null,
          tintColor: pmCharData?.tintColor ?? null,
          party: pmPartyId,
          partyName: pmParty?.name ?? null,
          partyColor: pmParty?.color ?? null,
          partyLogoUrl: pmParty?.logoUrl ?? null,
          confirmedAt: (govFormation.formedAt ?? new Date()).toISOString(),
        }
      : null;

  const cabinetPositions = resolveCabinetRoster(
    getCabinetPositions(countryId),
    await getLiveGameYear(db)
  );

  // Build positions with members and cooldowns
  const positions = cabinetPositions.map((pos) => {
    // Head-of-government seat: auto-filled from the PM, never appointable, no cooldown.
    if (pos.isHeadOfGovernment) {
      return {
        id: pos.id,
        name: pos.name,
        order: pos.order,
        isHeadOfGovernment: true,
        member: headOfGovernmentMember,
        cooldownUntil: null,
        nomination: null,
      };
    }

    const member = memberMap.get(pos.id) as UnifiedCabinetMember | undefined;
    const cooldownUntil = cooldownMap.get(pos.id) || null;
    const party = member?.party ? partyBySeqId.get(String(member.party)) : undefined;

    return {
      id: pos.id,
      name: pos.name,
      order: pos.order,
      isHeadOfGovernment: false,
      member: member
        ? (() => {
            // NPP-held seats (caretaker / NPP-government minister) have a null
            // characterId and no character doc — surface them as the seating NPP
            // rather than as a vacant seat.
            const charData = member.characterId
              ? charDataMap.get(member.characterId.toString())
              : undefined;
            return {
              characterId: member.characterId ? member.characterId.toString() : null,
              sequentialId: charData?.sequentialId ?? null,
              characterName: member.characterName,
              avatarUrl: charData?.avatarUrl ?? null,
              borderKey: charData?.borderKey ?? null,
              tintColor: charData?.tintColor ?? null,
              party: member.party,
              partyName: party?.name ?? null,
              partyColor: party?.color ?? null,
              partyLogoUrl: party?.logoUrl ?? null,
              confirmedAt: member.appointedAt.toISOString(),
              isNPP: member.isNPP ?? false,
            };
          })()
        : null,
      cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
      nomination: null,
    };
  });

  return NextResponse.json({
    countryId,
    positions,
    isPrimeMinister,
    isAdmin: authUser?.isAdmin ?? false,
    isOnePartyState,
    governingPartyId: govFormation?.governingPartyId ?? null,
    coalitionPartnerIds: (govFormation?.coalitionPartyIds ?? []).filter(
      (pid) => pid !== govFormation?.governingPartyId
    ),
  });
}
