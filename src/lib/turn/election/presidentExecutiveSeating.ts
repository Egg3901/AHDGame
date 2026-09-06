import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectedOfficial,
  NPP,
  Character,
  CareerEvent,
  OfficeType,
} from "@/lib/db/types";
import { getOfficeLabel } from "@/lib/utils/politics";
import { clearCabinetOnTransition } from "@/lib/cabinetTransition";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import { incrementExecutiveTermsServedUpdate } from "@/lib/elections/executiveTermLimits";
import { initialVpActionFields } from "@/lib/constants/vicePresidentActions";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import {
  pinnedSingleplayerHeadOfState,
  seatSingleplayerHeadOfState,
} from "@/lib/singleplayerHeadOfState";

export interface SeatPresidentialExecutiveParams {
  election: Election;
  winnerCandidate: ElectionCandidate;
  vpCharId?: ObjectId;
  vpNppId?: ObjectId;
  now: Date;
}

export async function seatPresidentialExecutive(
  db: Db,
  params: SeatPresidentialExecutiveParams
): Promise<void> {
  const { election, winnerCandidate, vpCharId, vpNppId, now } = params;
  const electionCountry = (election.countryId ??
    COUNTRY_CONFIGS.US.id) as typeof COUNTRY_CONFIGS.US.id;
  const resolutionCountryId = election.countryId ?? "US";

  const pinned = await pinnedSingleplayerHeadOfState(db, electionCountry);
  if (pinned) {
    const preset = await getGameStatePresetOrDefault(db);
    await seatSingleplayerHeadOfState(db, {
      characterId: pinned._id,
      countryId: electionCountry,
      now,
      preset,
    });
    return;
  }

  const currentPresident = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne(getExecutiveOfficialFilter(electionCountry, "president"));

  const sameIncumbentReelected =
    (!winnerCandidate.isNPP &&
      winnerCandidate.characterId != null &&
      currentPresident?.characterId?.equals(winnerCandidate.characterId)) ||
    (winnerCandidate.isNPP &&
      winnerCandidate.nppId != null &&
      currentPresident?.nppId?.equals(winnerCandidate.nppId));

  if (!sameIncumbentReelected) {
    await clearCabinetOnTransition(db, electionCountry);
  }

  const excludeCharIds: ObjectId[] = [];
  if (!winnerCandidate.isNPP && winnerCandidate.characterId) {
    excludeCharIds.push(winnerCandidate.characterId);
  }
  if (vpCharId) excludeCharIds.push(vpCharId);

  await db.collection<Character>("characters").updateMany(
    {
      countryId: resolutionCountryId,
      "currentOffice.type": "president",
      ...(excludeCharIds.length > 0 ? { _id: { $nin: excludeCharIds } } : {}),
    },
    { $set: { currentOffice: null, updatedAt: now } }
  );

  await db.collection<Character>("characters").updateMany(
    {
      countryId: resolutionCountryId,
      "currentOffice.type": "vicePresident",
      ...(excludeCharIds.length > 0 ? { _id: { $nin: excludeCharIds } } : {}),
    },
    { $set: { currentOffice: null, updatedAt: now } }
  );

  await db.collection<NPP>("npps").updateMany(
    {
      countryId: resolutionCountryId,
      "currentOffice.type": { $in: ["president", "vicePresident"] },
    },
    { $set: { currentOffice: null, updatedAt: now } }
  );

  await db.collection<ElectedOfficial>("electedOfficials").updateMany(
    { countryId: resolutionCountryId, officeType: { $in: ["president", "vicePresident"] } },
    {
      $set: {
        characterId: null,
        characterName: null,
        party: null,
        isNPP: false,
        nppId: null,
        updatedAt: now,
      } as Record<string, unknown>,
    }
  );

  if (!winnerCandidate.isNPP && winnerCandidate.characterId) {
    await db.collection<ElectedOfficial>("electedOfficials").updateMany(
      {
        characterId: winnerCandidate.characterId,
        officeType: { $nin: ["president", "vicePresident"] },
      },
      {
        $set: {
          characterId: null,
          characterName: null,
          party: null,
          isNPP: false,
          updatedAt: now,
        } as Record<string, unknown>,
      }
    );
    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: winnerCandidate.characterId },
        { $set: { currentOffice: null, updatedAt: now } }
      );
  }

  if (vpCharId) {
    await db.collection<ElectedOfficial>("electedOfficials").updateMany(
      {
        characterId: vpCharId,
        officeType: { $nin: ["president", "vicePresident"] },
      },
      {
        $set: {
          characterId: null,
          characterName: null,
          party: null,
          isNPP: false,
          updatedAt: now,
        } as Record<string, unknown>,
      }
    );
    await db
      .collection<Character>("characters")
      .updateOne({ _id: vpCharId }, { $set: { currentOffice: null, updatedAt: now } });
  }

  await db.collection<ElectedOfficial>("electedOfficials").updateOne(
    getExecutiveOfficialFilter(electionCountry, "president"),
    {
      $set: {
        countryId: electionCountry,
        characterId: winnerCandidate.isNPP ? null : winnerCandidate.characterId,
        characterName: winnerCandidate.characterName,
        party: winnerCandidate.party,
        isNPP: winnerCandidate.isNPP ?? false,
        nppId: winnerCandidate.nppId ?? undefined,
        electedAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  if (winnerCandidate.isNPP && winnerCandidate.nppId) {
    await db.collection<NPP>("npps").updateOne(
      { _id: winnerCandidate.nppId },
      {
        $set: {
          currentOffice: { type: "president" },
          party: winnerCandidate.party,
          updatedAt: now,
        },
      }
    );
  } else if (winnerCandidate.characterId) {
    const winnerCharacter = await db
      .collection<Character>("characters")
      .findOne(
        { _id: winnerCandidate.characterId },
        { projection: { careerHistory: 1, executiveTermsServed: 1 } }
      );
    const presidentOffice: OfficeType = { type: "president" };
    const presidentCareer: CareerEvent = {
      type: "elected",
      office: presidentOffice,
      officeLabel: getOfficeLabel(presidentOffice, election.countryId),
      party: winnerCandidate.party,
      partyCountryId: election.countryId,
      electionId: election._id.toString(),
      date: now,
    };
    await db.collection<Character>("characters").updateOne(
      { _id: winnerCandidate.characterId },
      {
        $set: {
          currentOffice: presidentOffice,
          updatedAt: now,
          ...incrementExecutiveTermsServedUpdate(
            winnerCharacter ?? { executiveTermsServed: undefined },
            electionCountry
          ),
        },
        $push: { careerHistory: presidentCareer },
      }
    );
  }

  if (vpCharId) {
    const vpChar = await db.collection<Character>("characters").findOne({ _id: vpCharId });
    if (vpChar) {
      await db.collection<ElectedOfficial>("electedOfficials").updateOne(
        getExecutiveOfficialFilter(electionCountry, "vicePresident"),
        {
          $set: {
            countryId: electionCountry,
            characterId: vpCharId,
            characterName: vpChar.name,
            party: vpChar.party,
            isNPP: false,
            nppId: undefined,
            electedAt: now,
            updatedAt: now,
            // Seed the VP self-serve action pool on seating (#67), mirroring
            // initialMinisterialActionFields on cabinet appointment.
            ...initialVpActionFields(now),
          },
        },
        { upsert: true }
      );
      const vpOffice: OfficeType = { type: "vicePresident" };
      const vpCareer: CareerEvent = {
        type: "elected",
        office: vpOffice,
        officeLabel: getOfficeLabel(vpOffice, election.countryId),
        party: vpChar.party,
        partyCountryId: election.countryId,
        electionId: election._id.toString(),
        date: now,
      };
      await db.collection<Character>("characters").updateOne(
        { _id: vpCharId },
        {
          $set: { currentOffice: vpOffice, updatedAt: now },
          $push: { careerHistory: vpCareer },
        }
      );
    }
  }

  if (vpNppId) {
    const vpNpp = await db.collection<NPP>("npps").findOne({ _id: vpNppId });
    if (vpNpp) {
      await db.collection<ElectedOfficial>("electedOfficials").updateOne(
        getExecutiveOfficialFilter(electionCountry, "vicePresident"),
        {
          $set: {
            countryId: electionCountry,
            characterId: null,
            characterName: vpNpp.name,
            party: vpNpp.party,
            isNPP: true,
            nppId: vpNppId,
            electedAt: now,
            updatedAt: now,
            // Keep the office doc uniform; an NPP VP never spends these.
            ...initialVpActionFields(now),
          },
        },
        { upsert: true }
      );
      await db
        .collection<NPP>("npps")
        .updateOne(
          { _id: vpNppId },
          { $set: { currentOffice: { type: "vicePresident" }, updatedAt: now } }
        );
    }
  }

  // Root-cause guard: a newly-seated President/VP must not remain an active
  // candidate in any other (down-ballot) race. A lingering candidacy would
  // otherwise resolve later and seat the executive into a second office — the
  // failure mode that left a former candidate occupying a Senate seat after
  // ascending to the executive ticket.
  const execIdentityOr: Record<string, unknown>[] = [];
  if (!winnerCandidate.isNPP && winnerCandidate.characterId)
    execIdentityOr.push({ characterId: winnerCandidate.characterId });
  if (winnerCandidate.isNPP && winnerCandidate.nppId)
    execIdentityOr.push({ nppId: winnerCandidate.nppId });
  if (vpCharId) execIdentityOr.push({ characterId: vpCharId });
  if (vpNppId) execIdentityOr.push({ nppId: vpNppId });
  if (execIdentityOr.length > 0) {
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateMany(
        { status: "active", $or: execIdentityOr },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
  }
}
