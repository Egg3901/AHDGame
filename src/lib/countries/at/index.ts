import type { CountryFolder } from "../contract";
import { AT_IDENTITY } from "./identity";
import { AT_INSTITUTIONS } from "./institutions";
import { AT_ELECTIONS } from "./elections";
import { AT_ECONOMY } from "./economy";
import { AT_GEOGRAPHY } from "./geography";
import { AT_ERAS } from "./eras";

/**
 * Austria's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const AT: CountryFolder = {
  id: "AT",
  identity: AT_IDENTITY,
  institutions: AT_INSTITUTIONS,
  elections: AT_ELECTIONS,
  economy: AT_ECONOMY,
  geography: AT_GEOGRAPHY,
  eras: AT_ERAS,
};

export { AT_IDENTITY } from "./identity";
export { AT_INSTITUTIONS } from "./institutions";
export { AT_ELECTIONS } from "./elections";
export { AT_ECONOMY } from "./economy";
export { AT_GEOGRAPHY } from "./geography";
export { AT_ERAS } from "./eras";
