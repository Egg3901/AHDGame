import type { CountryFolder } from "../contract";
import { SE_IDENTITY } from "./identity";
import { SE_INSTITUTIONS } from "./institutions";
import { SE_ELECTIONS } from "./elections";
import { SE_ECONOMY } from "./economy";
import { SE_GEOGRAPHY } from "./geography";
import { SE_ERAS } from "./eras";

/**
 * Sweden's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const SE: CountryFolder = {
  id: "SE",
  identity: SE_IDENTITY,
  institutions: SE_INSTITUTIONS,
  elections: SE_ELECTIONS,
  economy: SE_ECONOMY,
  geography: SE_GEOGRAPHY,
  eras: SE_ERAS,
};

export { SE_IDENTITY } from "./identity";
export { SE_INSTITUTIONS } from "./institutions";
export { SE_ELECTIONS } from "./elections";
export { SE_ECONOMY } from "./economy";
export { SE_GEOGRAPHY } from "./geography";
export { SE_ERAS } from "./eras";
