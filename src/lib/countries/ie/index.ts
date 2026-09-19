import type { CountryFolder } from "../contract";
import { IE_IDENTITY } from "./identity";
import { IE_INSTITUTIONS } from "./institutions";
import { IE_ELECTIONS } from "./elections";
import { IE_ECONOMY } from "./economy";
import { IE_GEOGRAPHY } from "./geography";
import { IE_ERAS } from "./eras";

/**
 * Ireland's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const IE: CountryFolder = {
  id: "IE",
  identity: IE_IDENTITY,
  institutions: IE_INSTITUTIONS,
  elections: IE_ELECTIONS,
  economy: IE_ECONOMY,
  geography: IE_GEOGRAPHY,
  eras: IE_ERAS,
};

export { IE_IDENTITY } from "./identity";
export { IE_INSTITUTIONS } from "./institutions";
export { IE_ELECTIONS } from "./elections";
export { IE_ECONOMY } from "./economy";
export { IE_GEOGRAPHY } from "./geography";
export { IE_ERAS } from "./eras";
