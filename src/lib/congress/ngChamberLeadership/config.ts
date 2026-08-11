/**
 * NG National Assembly presiding-officer role configuration.
 *
 * Both roles mirror the DE Bundestagspräsident mechanic (any seated chamber
 * member may declare and vote, plurality wins) but resolve into the
 * presiding-officer `electedOfficials` record the read-only presiding-officers
 * route already reads, rather than into `congressLeaders`. This keeps the NG
 * Leadership tab a single source of truth.
 */
import type { NgChamberLeadershipRole } from "@/lib/db/types";

export interface NgRoleConfig {
  role: NgChamberLeadershipRole;
  /** officeType of the seated members who form the electorate/nominee pool. */
  memberOfficeType: "house" | "senate";
  /** officeType of the presiding-officer electedOfficials record to write. */
  officerOfficeType: "speaker" | "senatePresident";
  /** Human-readable role name for copy and Discord announcements. */
  label: string;
}

export const NG_ROLE_CONFIG: Record<NgChamberLeadershipRole, NgRoleConfig> = {
  speaker_ng_reps: {
    role: "speaker_ng_reps",
    memberOfficeType: "house",
    officerOfficeType: "speaker",
    label: "Speaker of the House of Representatives",
  },
  president_ng_senate: {
    role: "president_ng_senate",
    memberOfficeType: "senate",
    officerOfficeType: "senatePresident",
    label: "President of the Senate",
  },
};

export const NG_ROLES: NgChamberLeadershipRole[] = ["speaker_ng_reps", "president_ng_senate"];

export function isNgChamberLeadershipRole(v: string): v is NgChamberLeadershipRole {
  return v === "speaker_ng_reps" || v === "president_ng_senate";
}

export const NG_ELECTION_COLLECTION = "ngChamberLeadershipElections";
export const NG_NOMINATION_COLLECTION = "ngChamberLeadershipNominations";
