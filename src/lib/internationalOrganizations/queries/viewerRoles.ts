import type { Db, ObjectId } from "mongodb";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import {
  DIPLOMATIC_ACTIONS_PER_TURN,
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
} from "@/lib/constants/internationalOrganizations";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { findCountryHeadedBy } from "@/lib/api/headOfGovernment";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getDiplomaticActionsRemaining } from "@/lib/internationalOrganizations/diplomaticActions";

export async function loadViewerOrganizationRoles(params: {
  db: Db;
  characterId: ObjectId | null;
  characterName?: string | null;
}) {
  const { db, characterId, characterName } = params;
  if (!characterId) {
    return {
      characterId: null,
      foreignMinisterOf: null,
      headOfGovernmentOf: null,
      diplomaticActionsRemaining: DIPLOMATIC_ACTIONS_PER_TURN,
      diplomaticActionsPerTurn: DIPLOMATIC_ACTIONS_PER_TURN,
      diplomaticActionsCountryId: null,
    };
  }

  // Resolve the foreign-affairs seat holder from the unified cabinetMembers
  // collection (the single source of truth). An NPP-held seat carries a null
  // characterId and never matches a player viewer.
  const cabinetCol = await getCabinetMembersCollection(db);
  const seats = COUNTRY_ORDER.flatMap((countryId) => {
    const positionId = FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[countryId];
    return positionId ? [{ countryId, positionId }] : [];
  });
  const heldSeats = await cabinetCol
    .find({ characterId, $or: seats }, { projection: { countryId: 1, positionId: 1 } })
    .toArray();
  const foreignMinisterOf: CountryId | null =
    COUNTRY_ORDER.find((countryId) =>
      heldSeats.some(
        (seat) =>
          seat.countryId === countryId &&
          seat.positionId === FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[countryId]
      )
    ) ?? null;

  const headOfGovernmentOf = await findCountryHeadedBy(db, characterId);

  // The diplomatic-action budget applies to the country the viewer acts for
  // (foreign minister takes precedence over head of government).
  const actingCountry: CountryId | null = foreignMinisterOf ?? headOfGovernmentOf;
  const currentTurn = await getCurrentTurn(db);
  const diplomaticActionsRemaining = actingCountry
    ? await getDiplomaticActionsRemaining(db, actingCountry, currentTurn)
    : DIPLOMATIC_ACTIONS_PER_TURN;

  return {
    characterId: characterId.toString(),
    characterName: characterName ?? null,
    foreignMinisterOf,
    foreignMinisterCountryName: foreignMinisterOf ? COUNTRY_CONFIGS[foreignMinisterOf].name : null,
    headOfGovernmentOf,
    headOfGovernmentCountryName: headOfGovernmentOf
      ? COUNTRY_CONFIGS[headOfGovernmentOf].name
      : null,
    diplomaticActionsRemaining,
    diplomaticActionsPerTurn: DIPLOMATIC_ACTIONS_PER_TURN,
    diplomaticActionsCountryId: actingCountry,
  };
}
