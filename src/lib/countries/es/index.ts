import type { CountryFolder } from "../contract";
import { ES_IDENTITY } from "./identity";
import { ES_INSTITUTIONS } from "./institutions";
import { ES_ELECTIONS } from "./elections";
import { ES_ECONOMY } from "./economy";
import { ES_GEOGRAPHY } from "./geography";
import { ES_ERAS } from "./eras";

/**
 * Spain's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const ES: CountryFolder = {
  id: "ES",
  identity: ES_IDENTITY,
  institutions: ES_INSTITUTIONS,
  elections: ES_ELECTIONS,
  economy: ES_ECONOMY,
  geography: ES_GEOGRAPHY,
  eras: ES_ERAS,
};

export { ES_IDENTITY } from "./identity";
export { ES_INSTITUTIONS } from "./institutions";
export { ES_ELECTIONS } from "./elections";
export { ES_ECONOMY } from "./economy";
export { ES_GEOGRAPHY } from "./geography";
export { ES_ERAS } from "./eras";
