/**
 * Soviet Union (RU) Cabinet positions — Council of Ministers of the USSR.
 * The Premier (Chairman of the Council of Ministers) appoints ministers
 * directly from Supreme Soviet deputies (spec §3, D7).
 *
 * Accepted abstractions (recorded in the design doc for the wiki phase):
 * a single First Deputy Chairman vs the real four; one Machine Building and
 * Heavy Industry portfolio vs many sectoral ministries; the Gosbank liaison
 * seat (the CN PBoC-liaison pattern) although Gosbank sat under the Finance
 * Ministry in this era; and 16 seats vs the real 50+ member Council.
 *
 * Year gating: the roster is 1953-authentic and valid for the whole Soviet
 * span, so every seat is perpetual; only the premier's title changes when the
 * Council of Ministers became the Cabinet of Ministers (1991 band). A
 * post-Soviet RU is a country-level roster question, out of scope here.
 */
export const RU_CABINET_POSITIONS = [
  {
    id: "premier",
    name: "Chairman of the Council of Ministers",
    order: 0,
    isHeadOfGovernment: true,
    yearEnabled: 1775,
    namesByYear: [
      { from: 1775, name: "Chairman of the Council of Ministers" },
      { from: 1991, name: "Prime Minister of the USSR" },
    ],
  },
  { id: "first_deputy_premier", name: "First Deputy Chairman", order: 1, yearEnabled: 1775 },
  {
    id: "minister_of_foreign_affairs",
    name: "Minister of Foreign Affairs",
    order: 2,
    yearEnabled: 1775,
  },
  { id: "minister_of_defence", name: "Minister of Defence", order: 3, yearEnabled: 1775 },
  { id: "minister_of_finance", name: "Minister of Finance", order: 4, yearEnabled: 1775 },
  {
    id: "minister_of_internal_affairs",
    name: "Minister of Internal Affairs",
    order: 5,
    yearEnabled: 1775,
  },
  {
    id: "chairman_of_gosplan",
    name: "Chairman of the State Planning Committee (Gosplan)",
    order: 6,
    yearEnabled: 1775,
  },
  { id: "gosbank_liaison", name: "Council Liaison to Gosbank", order: 7, yearEnabled: 1775 },
  {
    id: "minister_of_foreign_trade",
    name: "Minister of Foreign Trade",
    order: 8,
    yearEnabled: 1775,
  },
  {
    id: "minister_of_internal_trade",
    name: "Minister of Internal Trade",
    order: 9,
    yearEnabled: 1775,
  },
  { id: "minister_of_agriculture", name: "Minister of Agriculture", order: 10, yearEnabled: 1775 },
  {
    id: "minister_of_machine_building",
    name: "Minister of Machine Building and Heavy Industry",
    order: 11,
    yearEnabled: 1775,
  },
  { id: "minister_of_railways", name: "Minister of Railways", order: 12, yearEnabled: 1775 },
  { id: "minister_of_culture", name: "Minister of Culture", order: 13, yearEnabled: 1775 },
  { id: "minister_of_health", name: "Minister of Health", order: 14, yearEnabled: 1775 },
  {
    id: "minister_of_higher_education",
    name: "Minister of Higher Education",
    order: 15,
    yearEnabled: 1775,
  },
] as const;

export type RUCabinetPositionId = (typeof RU_CABINET_POSITIONS)[number]["id"];
