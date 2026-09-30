/**
 * European organization presentation follows the enacted institutional stage.
 * The stable EU record keeps memberships, funds and agreements through reform.
 */
import type { InternationalOrganizationDef } from "@/lib/constants/internationalOrganizations";
import {
  COMMUNITY_MEMBERS_1979,
  COMMUNITY_MEMBERS_1991,
  type EuropeanIntegrationState,
} from "./rules";

const MEMBERS_2019 = [
  ...COMMUNITY_MEMBERS_1991,
  "AT",
  "FI",
  "SE",
  "CY",
  "CZ2",
  "EE",
  "HU",
  "LV",
  "LT",
  "MT",
  "PL",
  "SK",
  "SI",
  "BG",
  "RO",
  "HR",
];

export function withEuropeanInstitution(
  def: InternationalOrganizationDef,
  state: EuropeanIntegrationState
): InternationalOrganizationDef {
  if (def.id !== "EU") return def;
  const historicalRoster = state.source !== "legacy-settlement";
  const rosters = historicalRoster
    ? {
        ...def.foundingMembersByEra,
        "1979-default": [...COMMUNITY_MEMBERS_1979],
        "1991-default": [...COMMUNITY_MEMBERS_1991],
        "2019-default": MEMBERS_2019,
        "2027-default": MEMBERS_2019.filter((member) => member !== "UK"),
      }
    : def.foundingMembersByEra;
  if (state.stage === "union") return { ...def, foundingMembersByEra: rosters };
  return {
    ...def,
    name: "European Economic Community",
    shortName: "EEC",
    description:
      "A community of European states maintaining a common market. Further political integration requires treaty ratification by its members.",
    foundedYear: 1958,
    foundingMembers: historicalRoster ? def.foundingMembers : [],
    foundingMembersByEra: rosters,
    leadership: { ...def.leadership, title: "President of the Council" },
    charter:
      "Members cooperate through a common market and Community institutions. The Maastricht Treaty remains a separate decision and does not take effect without member ratification.",
  };
}
