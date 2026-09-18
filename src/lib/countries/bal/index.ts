import type { CountryFolder } from "../contract";
import { BAL_IDENTITY } from "./identity";
import { BAL_INSTITUTIONS } from "./institutions";
import { BAL_ELECTIONS } from "./elections";
import { BAL_ECONOMY } from "./economy";
import { BAL_GEOGRAPHY } from "./geography";
import { BAL_ERAS } from "./eras";

/**
 * the Baltic States's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const BAL: CountryFolder = {
  id: "BAL",
  identity: BAL_IDENTITY,
  institutions: BAL_INSTITUTIONS,
  elections: BAL_ELECTIONS,
  economy: BAL_ECONOMY,
  geography: BAL_GEOGRAPHY,
  eras: BAL_ERAS,
};

export { BAL_IDENTITY } from "./identity";
export { BAL_INSTITUTIONS } from "./institutions";
export { BAL_ELECTIONS } from "./elections";
export { BAL_ECONOMY } from "./economy";
export { BAL_GEOGRAPHY } from "./geography";
export { BAL_ERAS } from "./eras";
