import type { CountryFolder } from "../contract";
import { BR_IDENTITY } from "./identity";
import { BR_INSTITUTIONS } from "./institutions";
import { BR_ELECTIONS } from "./elections";
import { BR_ECONOMY } from "./economy";
import { BR_GEOGRAPHY } from "./geography";
import { BR_ERAS } from "./eras";

/**
 * Brazil's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const BR: CountryFolder = {
  id: "BR",
  identity: BR_IDENTITY,
  institutions: BR_INSTITUTIONS,
  elections: BR_ELECTIONS,
  economy: BR_ECONOMY,
  geography: BR_GEOGRAPHY,
  eras: BR_ERAS,
};

export { BR_IDENTITY } from "./identity";
export { BR_INSTITUTIONS } from "./institutions";
export { BR_ELECTIONS } from "./elections";
export { BR_ECONOMY } from "./economy";
export { BR_GEOGRAPHY } from "./geography";
export { BR_ERAS } from "./eras";
