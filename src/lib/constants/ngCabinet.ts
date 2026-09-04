/**
 * Nigeria (NG) Cabinet positions — the Federal Executive Council.
 *
 * Nigeria is a presidential republic: the directly elected President is head of
 * state and government and appoints ministers (confirmed by the Senate). Like
 * the US cabinet, no position is flagged `isHeadOfGovernment` — the President is
 * elected, not a cabinet appointee, and the elected Vice President is not an
 * appointable seat. These are the appointable portfolios only.
 */
export const NG_CABINET_POSITIONS = [
  {
    id: "secretary_to_government",
    yearEnabled: 1775,
    name: "Secretary to the Government of the Federation",
    order: 0,
  },
  { id: "minister_of_finance", yearEnabled: 1775, name: "Minister of Finance", order: 1 },
  {
    id: "minister_of_petroleum_resources",
    yearEnabled: 1775,
    name: "Minister of Petroleum Resources",
    order: 2,
  },
  { id: "minister_of_defence", yearEnabled: 1775, name: "Minister of Defence", order: 3 },
  {
    id: "minister_of_foreign_affairs",
    yearEnabled: 1775,
    name: "Minister of Foreign Affairs",
    order: 4,
  },
  { id: "minister_of_interior", yearEnabled: 1775, name: "Minister of Interior", order: 5 },
  {
    id: "minister_of_justice",
    yearEnabled: 1775,
    name: "Attorney-General and Minister of Justice",
    order: 6,
  },
  { id: "minister_of_health", yearEnabled: 1775, name: "Minister of Health", order: 7 },
  { id: "minister_of_education", yearEnabled: 1775, name: "Minister of Education", order: 8 },
  {
    id: "minister_of_works_housing",
    yearEnabled: 1775,
    name: "Minister of Works and Housing",
    order: 9,
  },
  { id: "minister_of_power", yearEnabled: 1775, name: "Minister of Power", order: 10 },
  {
    id: "minister_of_agriculture",
    yearEnabled: 1775,
    name: "Minister of Agriculture and Rural Development",
    order: 11,
  },
  {
    id: "minister_of_trade_industry",
    yearEnabled: 1775,
    name: "Minister of Industry, Trade and Investment",
    order: 12,
  },
  {
    id: "minister_of_labour",
    yearEnabled: 1775,
    name: "Minister of Labour and Employment",
    order: 13,
  },
  {
    id: "minister_of_information",
    yearEnabled: 1775,
    name: "Minister of Information and National Orientation",
    order: 14,
  },
  { id: "minister_of_environment", yearEnabled: 1775, name: "Minister of Environment", order: 15 },
  {
    id: "director_of_intelligence",
    yearEnabled: 1775,
    name: "Director of the Intelligence Service",
    order: 16,
  },
] as const;

export type NGCabinetPositionId = (typeof NG_CABINET_POSITIONS)[number]["id"];
