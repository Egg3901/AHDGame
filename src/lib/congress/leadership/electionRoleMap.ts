import type {
  HouseLeadershipElectionRole,
  LeadershipRole,
  SenateLeadershipElectionRole,
} from "@/lib/db/types";

/**
 * Per-chamber election roles (e.g. "majority_leader") map to a canonical
 * `LeadershipRole` value (e.g. "majority_leader_house"). Centralised here so
 * routes, the orchestrator, and the policy module key off the same mapping.
 */
export const HOUSE_ELECTION_ROLE_TO_LEADER: Record<HouseLeadershipElectionRole, LeadershipRole> = {
  majority_leader: "majority_leader_house",
  minority_leader: "minority_leader_house",
  majority_whip: "majority_whip_house",
  minority_whip: "minority_whip_house",
};

export const SENATE_ELECTION_ROLE_TO_LEADER: Record<SenateLeadershipElectionRole, LeadershipRole> =
  {
    pro_tempore: "president_pro_tempore",
    majority_leader: "majority_leader_senate",
    minority_leader: "minority_leader_senate",
    majority_whip: "majority_whip_senate",
    minority_whip: "minority_whip_senate",
  };

export function houseElectionRoleToLeader(role: HouseLeadershipElectionRole): LeadershipRole {
  return HOUSE_ELECTION_ROLE_TO_LEADER[role];
}

export function senateElectionRoleToLeader(role: SenateLeadershipElectionRole): LeadershipRole {
  return SENATE_ELECTION_ROLE_TO_LEADER[role];
}

/**
 * Display label for each `LeadershipRole`. Used wherever the raw snake_case
 * role would otherwise leak into user-facing text — Discord webhooks, admin
 * notifications, audit logs.
 */
export const LEADERSHIP_ROLE_LABEL: Record<LeadershipRole, string> = {
  speaker_of_the_house: "Speaker of the House",
  president_pro_tempore: "President Pro Tempore",
  speaker_of_the_bundestag: "Bundestagspräsident",
  chair_npcsc: "Chairman of the NPC Standing Committee",
  chair_cppcc: "Chairman of the CPPCC",
  speaker_ng_reps: "Speaker of the House of Representatives",
  president_ng_senate: "President of the Senate",
  majority_leader_house: "House Majority Leader",
  minority_leader_house: "House Minority Leader",
  majority_whip_house: "House Majority Whip",
  minority_whip_house: "House Minority Whip",
  majority_leader_senate: "Senate Majority Leader",
  minority_leader_senate: "Senate Minority Leader",
  majority_whip_senate: "Senate Majority Whip",
  minority_whip_senate: "Senate Minority Whip",
};

export function leadershipRoleLabel(role: LeadershipRole): string {
  return LEADERSHIP_ROLE_LABEL[role];
}
