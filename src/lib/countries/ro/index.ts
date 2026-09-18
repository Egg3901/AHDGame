import type { CountryFolder } from "../contract";
import { RO_IDENTITY } from "./identity";
import { RO_INSTITUTIONS } from "./institutions";
import { RO_ELECTIONS } from "./elections";
import { RO_ECONOMY } from "./economy";
import { RO_GEOGRAPHY } from "./geography";
import { RO_ERAS } from "./eras";

/**
 * Romania's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const RO: CountryFolder = {
  id: "RO",
  identity: RO_IDENTITY,
  institutions: RO_INSTITUTIONS,
  elections: RO_ELECTIONS,
  economy: RO_ECONOMY,
  geography: RO_GEOGRAPHY,
  eras: RO_ERAS,
};

export { RO_IDENTITY } from "./identity";
export { RO_INSTITUTIONS } from "./institutions";
export { RO_ELECTIONS } from "./elections";
export { RO_ECONOMY } from "./economy";
export { RO_GEOGRAPHY } from "./geography";
export { RO_ERAS } from "./eras";
