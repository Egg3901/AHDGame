/**
 * Live per-turn role bonuses for one character, for display. Mirrors the role
 * inputs the action refresh (src/lib/turn/actionRefresh.ts) loads for every
 * character, so profile pages and the status bar show what the next turn
 * grants. Callers pass the lookups they have already made.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types";
import { loadOrganizationHeads } from "@/lib/internationalOrganizations/orgHeadAgenda";
import type { LeadershipRole } from "@/lib/db/types/leadership";
import type { StatePartyOrg } from "@/lib/db/types/statePartyOrg";
import { resolveOppositionLeaderForCountry } from "@/lib/parliament/oppositionLeader";
import {
  JUSTICE_ACTION_BONUS,
  resolveLeadershipActionBonus,
  resolvePositionNiBonus,
  type CeoNiTier,
} from "./positionNiBonus";

export interface CharacterRoleBonusInput {
  character: {
    _id: ObjectId;
    countryId?: string;
    currentOffice?: { type: string } | null;
    ceoNiTier?: CeoNiTier | null;
  };
  party: {
    chairId?: ObjectId | null;
    viceChairId?: ObjectId | null;
    treasurerId?: ObjectId | null;
  } | null;
  congressLeadershipRoles: readonly LeadershipRole[];
  isSeatedJustice: boolean;
  isCentralBankChair: boolean;
  cabinetSeats: readonly { countryId?: string; acting?: boolean }[];
}

export interface CharacterRoleBonuses {
  /** Highest position NI tier plus any international add-on. */
  positionNiBonus: number;
  /** Chamber leadership AP (highest single role). */
  leadershipActionBonus: number;
  /** Supreme Court justice AP. */
  justiceActionBonus: number;
}

export async function loadCharacterRoleBonuses(
  db: Db,
  {
    character,
    party,
    congressLeadershipRoles,
    isSeatedJustice,
    isCentralBankChair,
    cabinetSeats,
  }: CharacterRoleBonusInput
): Promise<CharacterRoleBonuses> {
  const countryId = (character.countryId ?? "US") as CountryId;
  const id = character._id.toString();
  const [presiding, statePartyChair, orgSeats, opposition] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        { characterId: character._id, officeType: { $in: ["speaker", "senatePresident"] } },
        { projection: { officeType: 1 } }
      )
      .toArray(),
    db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ chairId: character._id }, { projection: { _id: 1 } }),
    loadOrganizationHeads(db, { characterId: character._id }).catch(() => []),
    resolveOppositionLeaderForCountry(db, countryId).catch(() => null),
  ]);

  const roles: LeadershipRole[] = [
    ...congressLeadershipRoles,
    ...presiding.map(
      (row) =>
        (row.officeType === "speaker" ? "speaker_ng_reps" : "president_ng_senate") as LeadershipRole
    ),
  ];
  const isOppositionLeader = opposition?.chairId.toString() === id;
  const isShadowCabinetMember = Object.values(opposition?.partyDoc?.shadowCabinet ?? {}).some(
    (appointment) => appointment?.characterId?.toString() === id
  );
  const cabinetSeat = cabinetSeats[0];

  return {
    positionNiBonus: resolvePositionNiBonus({
      currentOfficeType: character.currentOffice?.type,
      countryId,
      congressLeadershipRoles: roles,
      isPartyChair: party?.chairId?.toString() === id,
      isPartySubChair:
        party?.viceChairId?.toString() === id || party?.treasurerId?.toString() === id,
      isStatePartyChair: statePartyChair != null,
      isSeatedJustice,
      isCentralBankChair,
      cabinetCountryId: cabinetSeat
        ? ((cabinetSeat.countryId ?? countryId) as CountryId)
        : undefined,
      isActingCabinet:
        cabinetSeats.length > 0 && cabinetSeats.every((seat) => seat.acting === true),
      ceoTier: character.ceoNiTier ?? null,
      isOrgHead: orgSeats.length > 0,
    }),
    leadershipActionBonus: resolveLeadershipActionBonus({
      congressLeadershipRoles: roles,
      isOppositionLeader,
      isShadowCabinetMember,
    }),
    justiceActionBonus: isSeatedJustice ? JUSTICE_ACTION_BONUS : 0,
  };
}
