import type { CountryFolder } from "../contract";
import { US_IDENTITY } from "./identity";
import { US_INSTITUTIONS } from "./institutions";
import { US_ELECTIONS } from "./elections";
import { US_ECONOMY } from "./economy";
import { US_GEOGRAPHY } from "./geography";
import { US_ERAS } from "./eras";

/**
 * the United States's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const US: CountryFolder = {
  id: "US",
  identity: US_IDENTITY,
  institutions: US_INSTITUTIONS,
  elections: US_ELECTIONS,
  economy: US_ECONOMY,
  geography: US_GEOGRAPHY,
  eras: US_ERAS,
};

export { US_IDENTITY } from "./identity";
export { US_INSTITUTIONS } from "./institutions";
export { US_ELECTIONS } from "./elections";
export { US_ECONOMY } from "./economy";
export { US_GEOGRAPHY } from "./geography";
export { US_ERAS } from "./eras";
