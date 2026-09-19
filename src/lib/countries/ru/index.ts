import type { CountryFolder } from "../contract";
import { RU_IDENTITY } from "./identity";
import { RU_INSTITUTIONS } from "./institutions";
import { RU_ELECTIONS } from "./elections";
import { RU_ECONOMY } from "./economy";
import { RU_GEOGRAPHY } from "./geography";
import { RU_ERAS } from "./eras";

/**
 * Russia's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const RU: CountryFolder = {
  id: "RU",
  identity: RU_IDENTITY,
  institutions: RU_INSTITUTIONS,
  elections: RU_ELECTIONS,
  economy: RU_ECONOMY,
  geography: RU_GEOGRAPHY,
  eras: RU_ERAS,
};

export { RU_IDENTITY } from "./identity";
export { RU_INSTITUTIONS } from "./institutions";
export { RU_ELECTIONS } from "./elections";
export { RU_ECONOMY } from "./economy";
export { RU_GEOGRAPHY } from "./geography";
export { RU_ERAS } from "./eras";
