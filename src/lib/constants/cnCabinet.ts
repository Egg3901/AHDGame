/**
 * China (CN) Cabinet positions — State Council of the People's Republic of China.
 * The Premier appoints State Council ministers directly from NPC delegates.
 */
export const CN_CABINET_POSITIONS = [
  {
    id: "premier",
    yearEnabled: 1775,
    name: "Premier of the State Council",
    order: 0,
    isHeadOfGovernment: true,
  },
  { id: "vice_premier", yearEnabled: 1775, name: "Vice Premier", order: 1 },
  { id: "state_councillor", yearEnabled: 1775, name: "State Councillor", order: 2 },
  {
    id: "minister_of_foreign_affairs",
    yearEnabled: 1775,
    name: "Minister of Foreign Affairs",
    order: 3,
  },
  { id: "minister_of_finance", yearEnabled: 1775, name: "Minister of Finance", order: 4 },
  {
    id: "minister_of_defense",
    yearEnabled: 1775,
    name: "Chairman of the Central Military Commission",
    order: 5,
  },
  { id: "minister_of_education", yearEnabled: 1775, name: "Minister of Education", order: 6 },
  { id: "minister_of_health", yearEnabled: 1775, name: "Minister of Health", order: 7 },
  { id: "pboc_governor", yearEnabled: 1775, name: "State Council Liaison to the PBoC", order: 8 },
  {
    id: "minister_of_public_security",
    yearEnabled: 1775,
    name: "Minister of Public Security",
    order: 9,
  },
  { id: "minister_of_commerce", yearEnabled: 1775, name: "Minister of Commerce", order: 10 },
  {
    id: "minister_of_human_resources_social_security",
    yearEnabled: 1775,
    name: "Minister of Human Resources and Social Security",
    order: 11,
  },
  {
    id: "minister_of_ecology_environment",
    yearEnabled: 1775,
    name: "Minister of Ecology and Environment",
    order: 12,
  },
  { id: "minister_of_transport", yearEnabled: 1775, name: "Minister of Transport", order: 13 },
  {
    id: "minister_of_agriculture_rural_affairs",
    yearEnabled: 1775,
    name: "Minister of Agriculture and Rural Affairs",
    order: 14,
  },
  {
    id: "minister_of_housing_urban_rural",
    yearEnabled: 1775,
    name: "Minister of Housing and Urban-Rural Development",
    order: 15,
  },
] as const;

export type CNCabinetPositionId = (typeof CN_CABINET_POSITIONS)[number]["id"];
