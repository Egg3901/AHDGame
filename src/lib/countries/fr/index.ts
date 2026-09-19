import type { CountryFolder } from "../contract";
import { FR_IDENTITY } from "./identity";
import { FR_INSTITUTIONS } from "./institutions";
import { FR_ELECTIONS } from "./elections";
import { FR_ECONOMY } from "./economy";
import { FR_GEOGRAPHY } from "./geography";
import { FR_ERAS } from "./eras";

/**
 * France's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const FR: CountryFolder = {
  id: "FR",
  identity: FR_IDENTITY,
  institutions: FR_INSTITUTIONS,
  elections: FR_ELECTIONS,
  economy: FR_ECONOMY,
  geography: FR_GEOGRAPHY,
  eras: FR_ERAS,
};

export { FR_IDENTITY } from "./identity";
export { FR_INSTITUTIONS } from "./institutions";
export { FR_ELECTIONS } from "./elections";
export { FR_ECONOMY } from "./economy";
export { FR_GEOGRAPHY } from "./geography";
export { FR_ERAS } from "./eras";
