/**
 * East Germany (DD) Cabinet positions — Council of Ministers of the GDR
 * (Ministerrat der DDR). The General Secretary (DD's executive/head-of-government
 * office; see COUNTRY_CONFIGS.DD `generalSecretary`) appoints ministers directly
 * from Volkskammer deputies, mirroring the USSR Council of Ministers pattern.
 *
 * Slot IDs deliberately mirror RU_CABINET_POSITIONS one-for-one (a command-economy
 * council with the same portfolios/levers) so DD reuses the RU cabinet mechanics
 * verbatim (see ddCabinetMechanics.ts) — the IDs are internal, the `name`s are the
 * GDR-authentic labels players see. The head-of-government slot uses the id
 * `generalSecretary` to match DD's executive office key (the CN `premier` pattern),
 * and `minister_of_finance` matches COUNTRY_CONFIGS.DD.financeMinisterCabinetId.
 *
 * Year gating: canonical names are 1970s-authentic, so 1979 is clean and every
 * band/gate below is a 1950s correction — the National Defence ministry (1956,
 * before which the KVP sat under Interior), the Culture ministry (1954), the
 * Deutsche Notenbank → Staatsbank rename (1968), and the SED leader's
 * First Secretary title (1953–1976). DD's post-1990 absence is country-level
 * registration, not seat gating.
 */
export const DD_CABINET_POSITIONS = [
  {
    id: "generalSecretary",
    name: "General Secretary",
    order: 0,
    isHeadOfGovernment: true,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "General Secretary" },
      { from: 1953, name: "First Secretary" },
      { from: 1976, name: "General Secretary" },
    ],
  },
  {
    id: "first_deputy_premier",
    name: "First Deputy Chairman of the Council of Ministers",
    order: 1,
    yearEnabled: 1775,
  },
  {
    id: "minister_of_foreign_affairs",
    name: "Minister of Foreign Affairs",
    order: 2,
    yearEnabled: 1775,
  },
  { id: "minister_of_defence", name: "Minister of National Defence", order: 3, yearEnabled: 1956 },
  { id: "minister_of_finance", name: "Minister of Finance", order: 4, yearEnabled: 1775 },
  {
    id: "minister_of_internal_affairs",
    name: "Minister of Internal Affairs",
    order: 5,
    yearEnabled: 1775,
  },
  {
    id: "chairman_of_gosplan",
    name: "Chairman of the State Planning Commission",
    order: 6,
    yearEnabled: 1775,
  },
  {
    id: "gosbank_liaison",
    name: "Council Liaison to the Staatsbank",
    order: 7,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Council Liaison to the Deutsche Notenbank" },
      { from: 1968, name: "Council Liaison to the Staatsbank" },
    ],
  },
  {
    id: "minister_of_foreign_trade",
    name: "Minister of Foreign Trade",
    order: 8,
    yearEnabled: 1775,
  },
  {
    id: "minister_of_internal_trade",
    name: "Minister of Trade and Supply",
    order: 9,
    yearEnabled: 1775,
  },
  {
    id: "minister_of_agriculture",
    name: "Minister of Agriculture, Forestry and Food",
    order: 10,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Minister of Agriculture and Forestry" },
      { from: 1970, name: "Minister of Agriculture, Forestry and Food" },
    ],
  },
  {
    id: "minister_of_machine_building",
    name: "Minister of Heavy Industry and Machine Building",
    order: 11,
    yearEnabled: 1775,
  },
  { id: "minister_of_railways", name: "Minister of Transport", order: 12, yearEnabled: 1775 },
  { id: "minister_of_culture", name: "Minister of Culture", order: 13, yearEnabled: 1954 },
  { id: "minister_of_health", name: "Minister of Health", order: 14, yearEnabled: 1775 },
  {
    id: "minister_of_higher_education",
    name: "Minister of Higher and Technical Education",
    order: 15,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "State Secretary for Higher Education" },
      { from: 1967, name: "Minister of Higher and Technical Education" },
    ],
  },
  {
    id: "director_of_intelligence",
    name: "Minister for State Security",
    order: 16,
    yearEnabled: 1950,
  },
] as const;

export type DDCabinetPositionId = (typeof DD_CABINET_POSITIONS)[number]["id"];
