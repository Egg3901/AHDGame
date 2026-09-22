/**
 * Germany cabinet positions (Bundesregierung).
 * The Chancellor appoints ministers directly once the government is formed.
 */
export const DE_CABINET_POSITIONS = [
  { id: "finance_minister", yearEnabled: 1775, name: "Federal Minister of Finance", order: 1 },
  {
    id: "foreign_minister",
    yearEnabled: 1775,
    name: "Federal Minister for Foreign Affairs",
    order: 2,
  },
  {
    id: "interior_minister",
    yearEnabled: 1775,
    name: "Federal Minister of the Interior",
    order: 3,
  },
  { id: "defense_minister", yearEnabled: 1775, name: "Federal Minister of Defence", order: 4 },
  { id: "justice_minister", yearEnabled: 1775, name: "Federal Minister of Justice", order: 5 },
  {
    id: "economy_minister",
    yearEnabled: 1775,
    name: "Federal Minister for Economic Affairs",
    order: 6,
  },
  {
    id: "labour_minister",
    yearEnabled: 1775,
    name: "Federal Minister of Labour and Social Affairs",
    order: 7,
  },
  { id: "health_minister", yearEnabled: 1775, name: "Federal Minister of Health", order: 8 },
  { id: "transport_minister", yearEnabled: 1775, name: "Federal Minister for Transport", order: 9 },
  {
    id: "education_minister",
    yearEnabled: 1775,
    name: "Federal Minister of Education and Research",
    order: 10,
  },
  {
    id: "environment_minister",
    yearEnabled: 1775,
    name: "Federal Minister for the Environment",
    order: 11,
  },
] as const;

export type DECabinetPositionId = (typeof DE_CABINET_POSITIONS)[number]["id"];
