/**
 * Japan Cabinet positions (Cabinet of Japan / 内閣).
 * PM appoints directly — no Diet confirmation required for cabinet members.
 */
export const JP_CABINET_POSITIONS = [
  { id: "chief_cabinet_secretary", yearEnabled: 1775, name: "Chief Cabinet Secretary", order: 1 },
  { id: "finance_minister", yearEnabled: 1775, name: "Minister of Finance", order: 2 },
  {
    id: "foreign_affairs_minister",
    yearEnabled: 1775,
    name: "Minister of Foreign Affairs",
    order: 3,
  },
  { id: "justice_minister", yearEnabled: 1775, name: "Minister of Justice", order: 4 },
  { id: "defense_minister", yearEnabled: 1775, name: "Minister of Defense", order: 5 },
  {
    id: "economy_minister",
    yearEnabled: 1775,
    name: "Minister of Economy, Trade and Industry",
    order: 6,
  },
  {
    id: "health_minister",
    yearEnabled: 1775,
    name: "Minister of Health, Labour and Welfare",
    order: 7,
  },
  {
    id: "education_minister",
    yearEnabled: 1775,
    name: "Minister of Education, Culture, Sports, Science and Technology",
    order: 8,
  },
  {
    id: "land_minister",
    yearEnabled: 1775,
    name: "Minister of Land, Infrastructure, Transport and Tourism",
    order: 9,
  },
  { id: "environment_minister", yearEnabled: 1775, name: "Minister of the Environment", order: 10 },
  {
    id: "internal_affairs_minister",
    yearEnabled: 1775,
    name: "Minister of Internal Affairs and Communications",
    order: 11,
  },
] as const;

export type JPCabinetPositionId = (typeof JP_CABINET_POSITIONS)[number]["id"];
