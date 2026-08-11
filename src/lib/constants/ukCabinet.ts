/**
 * UK Cabinet positions (His Majesty's Government).
 * PM appoints directly — no parliamentary confirmation.
 *
 * Year gating: seats carry `yearEnabled`/`yearRetired`/`namesByYear` resolved
 * against the live game year (see src/lib/cabinet/rosterEra.ts). Whitehall
 * reshuffles are deliberately compressed to bands that are correct at each
 * preset year (1953/1979/1991/2019) and stay sensible in between. The
 * agriculture seat (MAFF) retires in 2001 and hands its incumbent to the
 * DEFRA-style environment seat via `succeededBy` — the two share `order: 12`
 * because their lifetimes are disjoint.
 */
export const UK_CABINET_POSITIONS = [
  { id: "deputy_prime_minister", name: "Deputy Prime Minister", order: 0, yearEnabled: 1775 },
  { id: "first_secretary_of_state", name: "First Secretary of State", order: 1, yearEnabled: 1962 },
  { id: "chancellor", name: "Chancellor of the Exchequer", order: 2, yearEnabled: 1775 },
  { id: "foreign_secretary", name: "Foreign Secretary", order: 3, yearEnabled: 1775 },
  { id: "home_secretary", name: "Home Secretary", order: 4, yearEnabled: 1775 },
  {
    id: "defence_secretary",
    name: "Secretary of State for Defence",
    order: 5,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Minister of Defence" },
      { from: 1964, name: "Secretary of State for Defence" },
    ],
  },
  {
    id: "justice_secretary",
    name: "Lord Chancellor & Secretary of State for Justice",
    order: 6,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Lord Chancellor" },
      { from: 2007, name: "Lord Chancellor & Secretary of State for Justice" },
    ],
  },
  {
    id: "health_secretary",
    name: "Secretary of State for Health and Social Care",
    order: 7,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Minister of Health" },
      { from: 1968, name: "Secretary of State for Social Services" },
      { from: 1988, name: "Secretary of State for Health" },
      { from: 2018, name: "Secretary of State for Health and Social Care" },
    ],
  },
  {
    id: "education_secretary",
    name: "Secretary of State for Education",
    order: 8,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Minister of Education" },
      { from: 1964, name: "Secretary of State for Education and Science" },
      { from: 2010, name: "Secretary of State for Education" },
    ],
  },
  {
    id: "business_secretary",
    name: "Secretary of State for Business, Energy and Industrial Strategy",
    order: 9,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "President of the Board of Trade" },
      { from: 1970, name: "Secretary of State for Trade and Industry" },
      { from: 2016, name: "Secretary of State for Business, Energy and Industrial Strategy" },
      { from: 2023, name: "Secretary of State for Business and Trade" },
    ],
  },
  {
    id: "levelling_secretary",
    name: "Secretary of State for Housing, Communities and Local Government",
    order: 10,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Minister of Housing and Local Government" },
      { from: 1970, name: "Secretary of State for the Environment" },
      { from: 2001, name: "Secretary of State for Communities and Local Government" },
      { from: 2018, name: "Secretary of State for Housing, Communities and Local Government" },
      { from: 2021, name: "Secretary of State for Levelling Up" },
      { from: 2023, name: "Secretary of State for Housing, Communities and Local Government" },
    ],
  },
  {
    id: "transport_secretary",
    name: "Secretary of State for Transport",
    order: 11,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Minister of Transport" },
      { from: 1976, name: "Secretary of State for Transport" },
    ],
  },
  {
    id: "agriculture_secretary",
    name: "Minister of Agriculture, Fisheries and Food",
    order: 12,
    yearEnabled: 1775,
    yearRetired: 2001,
    succeededBy: "environment_secretary",
    namesByYear: [
      { from: 1775, name: "Minister of Agriculture and Fisheries" },
      { from: 1955, name: "Minister of Agriculture, Fisheries and Food" },
    ],
  },
  {
    id: "environment_secretary",
    name: "Secretary of State for Environment, Food and Rural Affairs",
    order: 12,
    yearEnabled: 2001,
  },
  {
    id: "work_secretary",
    name: "Secretary of State for Work and Pensions",
    order: 13,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Minister of Labour and National Service" },
      { from: 1959, name: "Minister of Labour" },
      { from: 1968, name: "Secretary of State for Employment" },
      { from: 2001, name: "Secretary of State for Work and Pensions" },
    ],
  },
  {
    id: "northern_ireland",
    name: "Secretary of State for Northern Ireland",
    order: 14,
    yearEnabled: 1972,
  },
  { id: "scotland", name: "Secretary of State for Scotland", order: 15, yearEnabled: 1775 },
  { id: "wales", name: "Secretary of State for Wales", order: 16, yearEnabled: 1964 },
] as const;

export type UKCabinetPositionId = (typeof UK_CABINET_POSITIONS)[number]["id"];
