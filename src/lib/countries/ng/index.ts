import type { CountryFolder } from "../contract";
import { NG_IDENTITY } from "./identity";
import { NG_INSTITUTIONS } from "./institutions";
import { NG_ELECTIONS } from "./elections";
import { NG_ECONOMY } from "./economy";
import { NG_GEOGRAPHY } from "./geography";
import { NG_ERAS } from "./eras";

/**
 * Nigeria's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const NG: CountryFolder = {
  id: "NG",
  identity: NG_IDENTITY,
  institutions: NG_INSTITUTIONS,
  elections: NG_ELECTIONS,
  economy: NG_ECONOMY,
  geography: NG_GEOGRAPHY,
  eras: NG_ERAS,
};

export { NG_IDENTITY } from "./identity";
export { NG_INSTITUTIONS } from "./institutions";
export { NG_ELECTIONS } from "./elections";
export { NG_ECONOMY } from "./economy";
export { NG_GEOGRAPHY } from "./geography";
export { NG_ERAS } from "./eras";
