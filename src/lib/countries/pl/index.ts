import type { CountryFolder } from "../contract";
import { PL_IDENTITY } from "./identity";
import { PL_INSTITUTIONS } from "./institutions";
import { PL_ELECTIONS } from "./elections";
import { PL_ECONOMY } from "./economy";
import { PL_GEOGRAPHY } from "./geography";
import { PL_ERAS } from "./eras";

/**
 * Poland's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const PL: CountryFolder = {
  id: "PL",
  identity: PL_IDENTITY,
  institutions: PL_INSTITUTIONS,
  elections: PL_ELECTIONS,
  economy: PL_ECONOMY,
  geography: PL_GEOGRAPHY,
  eras: PL_ERAS,
};

export { PL_IDENTITY } from "./identity";
export { PL_INSTITUTIONS } from "./institutions";
export { PL_ELECTIONS } from "./elections";
export { PL_ECONOMY } from "./economy";
export { PL_GEOGRAPHY } from "./geography";
export { PL_ERAS } from "./eras";
