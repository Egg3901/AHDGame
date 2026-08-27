/**
 * GET /api/whitehouse/cabinet — Cabinet members, pending nominations, positions
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import type {
  CabinetNomination,
  ElectedOfficial,
  PoliticalParty,
  UnifiedCabinetMember,
} from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import { bulkFetchCharacterNames } from "@/lib/db/characterLookup";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resolveCabinetRoster } from "@/lib/cabinet/rosterEra";
import { getManuallyEnabledSeats } from "@/lib/cabinet/liveGameYear";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";
import { getPartyHex } from "@/lib/utils/politics";
import { resolvePresidentialCountry } from "@/lib/executive/presidentialCountry";
import { getGameState } from "@/lib/gameState";
import { actingAppointmentsEnabled } from "@/lib/cabinet/actingEligibility";
import { ACTING_TENURE_TURNS } from "@/lib/cabinet/actingScope";
import { getActingChargesCollection } from "@/lib/db/collections/actingAppointmentCharges";

// GET /api/whitehouse/cabinet — Returns all cabinet positions with current members, pending nominations, and the caller's senator/president status.
// Country-scoped via ?country= (default US).
// Auth: public
// Errors: 400
export async function GET(request: Request) {
  try {
    const countryId = resolvePresidentialCountry(request);
    if (!countryId) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }
    const db = await getDb();
    const authUser = await getAuthUser().catch(() => null);

    const [cabinetMembers, nominations, presidentOfficial, myCharacter, parties] =
      await Promise.all([
        db.collection<UnifiedCabinetMember>("cabinetMembers").find({ countryId }).toArray(),
        db
          .collection<CabinetNomination>("cabinetNominations")
          .find({ countryId, status: { $in: ["active", "proposed"] } })
          .sort({ proposedAt: -1 })
          .toArray(),
        db
          .collection<ElectedOfficial>("electedOfficials")
          .findOne({ countryId, officeType: "president", characterId: { $ne: null } }),
        authUser
          ? db
              .collection<Character>("characters")
              .findOne({ userId: new ObjectId(authUser.userId) })
          : Promise.resolve(null),
        db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
      ]);

    // Build party lookup map using composite key for safety
    const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

    // Fetch character data for avatar URLs. NPP caretaker seats (V2.1) have a
    // null characterId, so filter them out before the character lookup.
    const characterIds = cabinetMembers
      .map((m) => m.characterId)
      .filter((id): id is NonNullable<typeof id> => !!id);
    const charMap = await bulkFetchCharacterNames(db, characterIds, { includeAvatar: true });

    const senatorOfficial = myCharacter
      ? await db.collection<ElectedOfficial>("electedOfficials").findOne({
          characterId: myCharacter._id,
          countryId,
          officeType: "senate",
        })
      : null;

    const isPresident =
      !!presidentOfficial?.characterId &&
      !!myCharacter &&
      presidentOfficial.characterId.equals(myCharacter._id);
    const isSenator = !!senatorOfficial;

    // Which seats this President has already spent their acting appointment
    // on, this presidency. Only loaded where the mechanic applies at all.
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;
    const spentChargePositions = new Set<string>();
    if (actingAppointmentsEnabled(countryId) && presidentOfficial?.characterId) {
      const charges = await getActingChargesCollection(db)
        .find({
          countryId,
          presidentCharacterId: presidentOfficial.characterId,
          presidencyStartedAt: presidentOfficial.electedAt ?? null,
        })
        .toArray();
      for (const charge of charges) spentChargePositions.add(charge.positionId);
    }

    const memberByPosition = new Map(cabinetMembers.map((m) => [m.positionId, m]));
    const nominationByPosition = new Map(nominations.map((n) => [n.positionId, n]));
    const myCharId = myCharacter?._id.toString();

    const positions = resolveCabinetRoster(
      getCabinetPositions(countryId),
      await getLiveGameYear(db),
      await getManuallyEnabledSeats(db)
    ).map((pos) => {
      const member = memberByPosition.get(pos.id);
      const nomination = nominationByPosition.get(pos.id);
      const myVote = nomination && myCharId ? (nomination.votes?.[myCharId] ?? null) : null;
      return {
        id: pos.id,
        name: pos.name,
        order: pos.order,
        member: member
          ? {
              // NPP caretaker seats (V2.1) have a null characterId — surface the
              // NPP instead so the cabinet page renders the seat as filled.
              characterId: member.characterId?.toString() ?? null,
              isNPP: member.isNPP ?? false,
              nppId: member.nppId?.toString() ?? null,
              sequentialId: member.characterId
                ? charMap.get(member.characterId.toString())?.sequentialId
                : undefined,
              characterName: member.characterName,
              party: member.party,
              partyName:
                member.party === "independent"
                  ? "Independent"
                  : (partyMap.get(member.party ?? "")?.name ?? member.party ?? "Unknown"),
              partyColor:
                member.party === "independent"
                  ? "#6B7280"
                  : getPartyHex(member.party ?? "", partyMap.get(member.party ?? "")?.color),
              avatarUrl: member.characterId
                ? charMap.get(member.characterId.toString())?.avatarUrl
                : undefined,
              // The real flag. This used to report `isNPP`, which both hid
              // genuine acting holders and mislabelled NPP-held seats as
              // acting. `isNPP` is already reported separately above.
              acting: member.acting === true,
              actingExpiresOnTurn: member.actingExpiresOnTurn ?? null,
              confirmedAt: (member.confirmedAt ?? member.createdAt).toISOString(),
            }
          : null,
        nomination: nomination
          ? {
              id: nomination._id.toString(),
              nomineeCharacterId: nomination.nomineeCharacterId.toString(),
              nomineeCharacterName: nomination.nomineeCharacterName,
              nomineeParty: nomination.nomineeParty,
              nomineePartyName:
                nomination.nomineeParty === "independent"
                  ? "Independent"
                  : (partyMap.get(nomination.nomineeParty ?? "")?.name ??
                    nomination.nomineeParty ??
                    "Unknown"),
              nomineePartyColor:
                nomination.nomineeParty === "independent"
                  ? "#6B7280"
                  : getPartyHex(
                      nomination.nomineeParty ?? "",
                      partyMap.get(nomination.nomineeParty ?? "")?.color
                    ),
              status: nomination.status,
              votesFor: nomination.votesFor,
              votesAgainst: nomination.votesAgainst,
              votesAbstain: nomination.votesAbstain,
              votingEndsAt: nomination.votingEndsAt?.toISOString() ?? null,
              myVote,
            }
          : null,
        // Whether this President has already spent their one acting
        // appointment for this seat. Drives the disabled state on the appoint
        // control, so the rule is visible before it is hit.
        actingChargeSpent: spentChargePositions.has(pos.id),
      };
    });

    return NextResponse.json({
      positions,
      isPresident,
      isSenator,
      isAdmin: authUser?.isAdmin ?? false,
      currentTurn,
      actingEnabled: actingAppointmentsEnabled(countryId),
      actingTenureTurns: ACTING_TENURE_TURNS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
