import type { CountryFolder } from "../contract";
import { CS_IDENTITY } from "./identity";
import { CS_INSTITUTIONS } from "./institutions";
import { CS_ELECTIONS } from "./elections";
import { CS_ECONOMY } from "./economy";
import { CS_GEOGRAPHY } from "./geography";
import { CS_ERAS } from "./eras";

/**
 * Czechoslovakia's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const CS: CountryFolder = {
  id: "CS",
  identity: CS_IDENTITY,
  institutions: CS_INSTITUTIONS,
  elections: CS_ELECTIONS,
  economy: CS_ECONOMY,
  geography: CS_GEOGRAPHY,
  eras: CS_ERAS,
};

export { CS_IDENTITY } from "./identity";
export { CS_INSTITUTIONS } from "./institutions";
export { CS_ELECTIONS } from "./elections";
export { CS_ECONOMY } from "./economy";
export { CS_GEOGRAPHY } from "./geography";
export { CS_ERAS } from "./eras";
