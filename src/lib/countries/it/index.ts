import type { CountryFolder } from "../contract";
import { IT_IDENTITY } from "./identity";
import { IT_INSTITUTIONS } from "./institutions";
import { IT_ELECTIONS } from "./elections";
import { IT_ECONOMY } from "./economy";
import { IT_GEOGRAPHY } from "./geography";
import { IT_ERAS } from "./eras";

/**
 * Italy's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const IT: CountryFolder = {
  id: "IT",
  identity: IT_IDENTITY,
  institutions: IT_INSTITUTIONS,
  elections: IT_ELECTIONS,
  economy: IT_ECONOMY,
  geography: IT_GEOGRAPHY,
  eras: IT_ERAS,
};

export { IT_IDENTITY } from "./identity";
export { IT_INSTITUTIONS } from "./institutions";
export { IT_ELECTIONS } from "./elections";
export { IT_ECONOMY } from "./economy";
export { IT_GEOGRAPHY } from "./geography";
export { IT_ERAS } from "./eras";
