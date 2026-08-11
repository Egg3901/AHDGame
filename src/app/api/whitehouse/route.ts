/**
 * GET /api/whitehouse — President, Vice President, admin flags, official IDs for appoint
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import type { ElectedOfficial, Character, PoliticalParty, CabinetNomination } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getExecutiveTermsServed } from "@/lib/elections/executiveTermLimits";
import { resolvePresidentialCountry } from "@/lib/executive/presidentialCountry";
import { resolveExecutiveHolder } from "@/lib/elections/resolveExecutiveHolder";
import { getGameTime } from "@/lib/time/gameTime";
import { pastRealTimestampToLarpDate } from "@/lib/utils/formatters";

// GET /api/whitehouse — Returns the current President and Vice President details along with caller admin and president flags.
// Country-scoped via ?country= (default US) so any presidential country renders the surface.
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
    const gameTime = await getGameTime();
    // "since" badges show the in-game week the official was seated, not the
    // real-world date (turn length is config-tunable and games start in
    // different years, so real dates lie).
    const seatedGameDate = (electedAt: Date | undefined | null): string | null =>
      electedAt
        ? pastRealTimestampToLarpDate(
            electedAt,
            gameTime.currentTurn,
            gameTime.lastTurnProcessed,
            gameTime.startingYear
          ) || null
        : null;

    const [presidentOfficial, vicePresidentOfficial, activeVpNomination] = await Promise.all([
      db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ countryId, officeType: "president" }),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ countryId, officeType: "vicePresident" }),
      db
        .collection<CabinetNomination>("cabinetNominations")
        .findOne({ countryId, positionId: "vicePresident", status: "active" }),
    ]);

    // Character-backed holders resolve below; NPP-backed holders (characterId
    // null, nppId set) fall through to the resolveExecutiveHolder branches.
    const presCharId = presidentOfficial?.characterId;
    const vpCharId = vicePresidentOfficial?.characterId;

    type ExecutiveInfo = {
      id: string;
      characterId: string;
      sequentialId?: number;
      characterName: string;
      party?: string;
      partyName?: string;
      partyColor?: string;
      countryId?: CountryId;
      avatarUrl?: string;
      administrationStartDate?: string | null;
      /** In-game week + year the official was seated (e.g. "Week 23, 1991"). */
      administrationStartGameDate?: string | null;
      /** True when the seat is held by an NPP (non-player politician). */
      isNPP?: boolean;
    } | null;
    let president: ExecutiveInfo = null;
    let vicePresident: ExecutiveInfo = null;
    // Sitting president's current term (1-based): executiveTermsServed is
    // incremented at each seating (election win or succession), so the stored
    // count IS the term in progress. Drives the Term Clock's "TERM n OF x".
    let presidentCurrentTerm: number | null = null;

    if (presCharId) {
      const char = await db.collection<Character>("characters").findOne({ _id: presCharId });
      if (char) {
        presidentCurrentTerm = Math.max(1, getExecutiveTermsServed(char, countryId));
        const charCountry: CountryId = char.countryId ?? countryId;
        const party = char.party
          ? await db
              .collection<PoliticalParty>("politicalParties")
              .findOne({ sequentialId: Number(char.party), countryId: charCountry })
          : null;
        president = {
          id: presidentOfficial!._id.toString(),
          characterId: char._id.toString(),
          sequentialId: char.sequentialId,
          characterName: char.name,
          party: char.party,
          partyName: party?.name ?? char.party,
          partyColor: party?.color,
          countryId: charCountry,
          avatarUrl: char.avatarUrl,
          administrationStartDate: presidentOfficial!.electedAt?.toISOString() ?? null,
          administrationStartGameDate: seatedGameDate(presidentOfficial!.electedAt),
          isNPP: false,
        };
      }
    } else if (presidentOfficial?.nppId) {
      // NPP-backed president (characterId null) — resolve via the shared helper.
      const holder = await resolveExecutiveHolder(db, presidentOfficial);
      if (holder) {
        president = {
          id: presidentOfficial._id.toString(),
          characterId: "",
          sequentialId: holder.sequentialId,
          characterName: holder.characterName,
          party: holder.party,
          partyName: holder.partyName,
          partyColor: holder.partyColor,
          countryId: holder.countryId,
          avatarUrl: holder.avatarUrl,
          administrationStartDate: holder.administrationStartDate,
          administrationStartGameDate: seatedGameDate(presidentOfficial.electedAt),
          isNPP: true,
        };
      }
    }

    if (vpCharId) {
      const char = await db.collection<Character>("characters").findOne({ _id: vpCharId });
      if (char) {
        const charCountry: CountryId = char.countryId ?? countryId;
        const party = char.party
          ? await db
              .collection<PoliticalParty>("politicalParties")
              .findOne({ sequentialId: Number(char.party), countryId: charCountry })
          : null;
        vicePresident = {
          id: vicePresidentOfficial!._id.toString(),
          characterId: char._id.toString(),
          sequentialId: char.sequentialId,
          characterName: char.name,
          party: char.party,
          partyName: party?.name ?? char.party,
          partyColor: party?.color,
          countryId: charCountry,
          avatarUrl: char.avatarUrl,
          administrationStartDate: vicePresidentOfficial!.electedAt?.toISOString() ?? null,
          administrationStartGameDate: seatedGameDate(vicePresidentOfficial!.electedAt),
          isNPP: false,
        };
      }
    } else if (vicePresidentOfficial?.nppId) {
      const holder = await resolveExecutiveHolder(db, vicePresidentOfficial);
      if (holder) {
        vicePresident = {
          id: vicePresidentOfficial._id.toString(),
          characterId: "",
          sequentialId: holder.sequentialId,
          characterName: holder.characterName,
          party: holder.party,
          partyName: holder.partyName,
          partyColor: holder.partyColor,
          countryId: holder.countryId,
          avatarUrl: holder.avatarUrl,
          administrationStartDate: holder.administrationStartDate,
          administrationStartGameDate: seatedGameDate(vicePresidentOfficial.electedAt),
          isNPP: true,
        };
      }
    }

    const myCharacter = authUser
      ? await db
          .collection<Character>("characters")
          .findOne({ userId: new ObjectId(authUser.userId) })
      : null;
    const isPresident =
      !!presidentOfficial?.characterId &&
      !!myCharacter &&
      presidentOfficial.characterId.equals(myCharacter._id);
    const isVicePresident =
      !!vicePresidentOfficial?.characterId &&
      !!myCharacter &&
      vicePresidentOfficial.characterId.equals(myCharacter._id);

    // Check if user is a senator (needed for VP nomination voting controls)
    const isSenator = myCharacter
      ? !!(await db.collection<ElectedOfficial>("electedOfficials").findOne({
          characterId: myCharacter._id,
          countryId,
          officeType: "senate",
        }))
      : false;

    // Build VP nomination payload, including the user's own vote if senator
    let vpNomination = null;
    if (activeVpNomination) {
      const myVoteKey = myCharacter?._id.toString() ?? "";
      const myVote =
        isSenator && myVoteKey
          ? ((activeVpNomination.votes?.[myVoteKey] as "for" | "against" | "abstain") ?? null)
          : null;
      vpNomination = {
        id: activeVpNomination._id.toString(),
        nomineeCharacterId: activeVpNomination.nomineeCharacterId.toString(),
        nomineeCharacterName: activeVpNomination.nomineeCharacterName,
        nomineeParty: activeVpNomination.nomineeParty,
        status: activeVpNomination.status,
        votesFor: activeVpNomination.votesFor,
        votesAgainst: activeVpNomination.votesAgainst,
        votesAbstain: activeVpNomination.votesAbstain,
        votingEndsAt: activeVpNomination.votingEndsAt?.toISOString() ?? null,
        myVote,
      };
    }

    return NextResponse.json({
      president,
      vicePresident,
      presidentCurrentTerm,
      presidentOfficialId: presidentOfficial?._id?.toString() ?? null,
      vicePresidentOfficialId: vicePresidentOfficial?._id?.toString() ?? null,
      isAdmin: authUser?.isAdmin ?? false,
      isPresident,
      isVicePresident,
      isSenator,
      vpNomination,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
