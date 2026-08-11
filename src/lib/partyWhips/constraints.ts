import { ObjectId, type Db } from "mongodb";
import {
  getCountryConfig,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import type {
  BillWhip,
  CabinetNomination,
  ConfidenceVote,
  CongressLeader,
  WhipIssuerRole,
} from "@/lib/db/types";

export type WhipChamber = BillWhip["chamber"];

/** Map from chamber key to the congressLeaders roles that may whip in it.
 *  Whips have whip authority by definition — historically the position was
 *  scaffolded but never wired in (bug user-report 2026-05-17). */
const CHAMBER_LEADER_ROLES: Record<string, Array<Pick<CongressLeader, "role">["role"]>> = {
  house: [
    "speaker_of_the_house",
    "majority_leader_house",
    "minority_leader_house",
    "majority_whip_house",
    "minority_whip_house",
  ],
  senate: [
    "president_pro_tempore",
    "majority_leader_senate",
    "minority_leader_senate",
    "majority_whip_senate",
    "minority_whip_senate",
  ],
};

const ROLE_TO_ISSUER_ROLE: Record<string, WhipIssuerRole> = {
  speaker_of_the_house: "speaker",
  president_pro_tempore: "speaker",
  majority_leader_house: "majorityLeader",
  minority_leader_house: "minorityLeader",
  majority_leader_senate: "majorityLeader",
  minority_leader_senate: "minorityLeader",
  majority_whip_house: "majorityWhip",
  minority_whip_house: "minorityWhip",
  majority_whip_senate: "majorityWhip",
  minority_whip_senate: "minorityWhip",
};

export async function getChamberLeaderRole(
  db: Db,
  characterId: ObjectId,
  chamber: string,
  partyId: string
): Promise<WhipIssuerRole | null> {
  const roles = CHAMBER_LEADER_ROLES[chamber];
  if (!roles || roles.length === 0) return null;

  const leader = await db.collection<CongressLeader>("congressLeaders").findOne({
    role: { $in: roles },
    characterId,
    party: partyId,
  });

  if (!leader) return null;
  return ROLE_TO_ISSUER_ROLE[leader.role] ?? null;
}

export function getConfidenceWhipChamber(countryId: CountryId): WhipChamber {
  return getCountryConfig(countryId).legislature.lowerChamber.key as WhipChamber;
}

export function getCabinetWhipChamber(countryId: CountryId): WhipChamber {
  const config = getCountryConfig(countryId);
  return (
    config.upperElectionSystem
      ? (config.legislature.upperChamber?.key ?? config.legislature.lowerChamber.key)
      : config.legislature.lowerChamber.key
  ) as WhipChamber;
}

export function getWhippableChambers(countryId: CountryId): WhipChamber[] {
  const config = getCountryConfig(countryId);
  const chambers = [
    config.legislature.lowerChamber.key,
    ...(config.legislature.upperChamber ? [config.legislature.upperChamber.key] : []),
    getSubNationalLegislatureKey(countryId),
  ];
  return Array.from(new Set(chambers)) as WhipChamber[];
}

export function isWhippableChamber(countryId: CountryId, chamber: string): chamber is WhipChamber {
  return getWhippableChambers(countryId).includes(chamber as WhipChamber);
}

export function isConfidenceVoteInCountry(
  vote: Pick<ConfidenceVote, "countryId">,
  countryId: CountryId
): boolean {
  return vote.countryId === countryId;
}

export function isCabinetNominationInCountry(
  nomination: Pick<CabinetNomination, "countryId">,
  countryId: CountryId
): boolean {
  return nomination.countryId === countryId;
}
