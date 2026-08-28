/**
 * Shared cabinet baseline for econ-only governments.
 *
 * The portfolio ids match the existing Nigeria and Eastern Bloc command seams,
 * so finance, diplomacy, trade, defence, and ministerial governance resolve a
 * real office instead of falling back to the head of government.
 */
import { NG_CABINET_MECHANICS } from "./ngCabinetMechanics";

export const ECON_COUNTRY_CABINET_POSITIONS = [
  { id: "minister_of_finance", yearEnabled: 1775, name: "Minister of Finance", order: 0 },
  {
    id: "minister_of_foreign_affairs",
    yearEnabled: 1775,
    name: "Minister of Foreign Affairs",
    order: 1,
  },
  { id: "minister_of_defence", yearEnabled: 1775, name: "Minister of Defence", order: 2 },
  { id: "minister_of_interior", yearEnabled: 1775, name: "Minister of Interior", order: 3 },
  { id: "minister_of_justice", yearEnabled: 1775, name: "Minister of Justice", order: 4 },
  { id: "minister_of_health", yearEnabled: 1775, name: "Minister of Health", order: 5 },
  {
    id: "minister_of_education",
    yearEnabled: 1775,
    name: "Minister of Education",
    order: 6,
  },
  {
    id: "minister_of_works_housing",
    yearEnabled: 1775,
    name: "Minister of Works and Housing",
    order: 7,
  },
  {
    id: "minister_of_agriculture",
    yearEnabled: 1775,
    name: "Minister of Agriculture",
    order: 8,
  },
  {
    id: "minister_of_trade_industry",
    yearEnabled: 1775,
    name: "Minister of Trade and Industry",
    order: 9,
  },
  { id: "minister_of_labour", yearEnabled: 1775, name: "Minister of Labour", order: 10 },
  {
    id: "minister_of_environment",
    yearEnabled: 1775,
    name: "Minister of the Environment",
    order: 11,
  },
] as const;

export const ECON_COUNTRY_CABINET_MECHANICS = Object.fromEntries(
  ECON_COUNTRY_CABINET_POSITIONS.map((position) => [position.id, NG_CABINET_MECHANICS[position.id]])
);
