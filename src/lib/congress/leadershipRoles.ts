/**
 * Congress leadership role definitions.
 * Shared between API routes and wiki/search modules.
 */
import type { LeadershipRole } from "@/lib/db/types";

export const LEADERSHIP_ROLES: {
  role: LeadershipRole;
  label: string;
  chamber: "house" | "senate";
}[] = [
  { role: "speaker_of_the_house", label: "Speaker of the House", chamber: "house" },
  { role: "majority_leader_house", label: "Majority Leader", chamber: "house" },
  { role: "minority_leader_house", label: "Minority Leader", chamber: "house" },
  { role: "majority_whip_house", label: "Majority Whip", chamber: "house" },
  { role: "minority_whip_house", label: "Minority Whip", chamber: "house" },
  { role: "president_pro_tempore", label: "President Pro Tempore", chamber: "senate" },
  { role: "majority_leader_senate", label: "Majority Leader", chamber: "senate" },
  { role: "minority_leader_senate", label: "Minority Leader", chamber: "senate" },
  { role: "majority_whip_senate", label: "Majority Whip", chamber: "senate" },
  { role: "minority_whip_senate", label: "Minority Whip", chamber: "senate" },
  {
    role: "speaker_ng_reps",
    label: "Speaker of the House of Representatives",
    chamber: "house",
  },
  { role: "president_ng_senate", label: "President of the Senate", chamber: "senate" },
];
