/**
 * Portable rules for assigning members after an organization approves a war.
 *
 * The shell resolves live access, legislatures, truces, alliances, and existing
 * wars, then passes only plain data here. Player nations retain a national vote;
 * NPP-governed nations join automatically; every other member is inert.
 */
export interface OrganizationWarMember {
  countryId: string;
  playerEnabled: boolean;
  nppGoverned: boolean;
  hasLegislature: boolean;
  legallyEligible: boolean;
}

export type OrganizationWarExclusionReason =
  "target" | "legally_ineligible" | "no_legislature" | "no_government";

export interface OrganizationWarPlan {
  playerLegislation: string[];
  automaticNpp: string[];
  excluded: Array<{ countryId: string; reason: OrganizationWarExclusionReason }>;
}

export function planOrganizationWarDeclaration(input: {
  targetCountryId: string;
  members: readonly OrganizationWarMember[];
}): OrganizationWarPlan {
  const playerLegislation: string[] = [];
  const automaticNpp: string[] = [];
  const excluded: OrganizationWarPlan["excluded"] = [];

  for (const member of input.members) {
    if (member.countryId === input.targetCountryId) {
      excluded.push({ countryId: member.countryId, reason: "target" });
      continue;
    }
    if (!member.legallyEligible) {
      excluded.push({ countryId: member.countryId, reason: "legally_ineligible" });
      continue;
    }
    if (member.playerEnabled) {
      if (member.hasLegislature) playerLegislation.push(member.countryId);
      else excluded.push({ countryId: member.countryId, reason: "no_legislature" });
      continue;
    }
    if (member.nppGoverned) automaticNpp.push(member.countryId);
    else excluded.push({ countryId: member.countryId, reason: "no_government" });
  }

  return { playerLegislation, automaticNpp, excluded };
}
