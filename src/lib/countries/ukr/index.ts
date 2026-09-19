import type { CountryFolder } from "../contract";
import { UKR_IDENTITY } from "./identity";
import { UKR_INSTITUTIONS } from "./institutions";
import { UKR_ELECTIONS } from "./elections";
import { UKR_ECONOMY } from "./economy";
import { UKR_GEOGRAPHY } from "./geography";
import { UKR_ERAS } from "./eras";

/**
 * Ukraine's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const UKR: CountryFolder = {
  id: "UKR",
  identity: UKR_IDENTITY,
  institutions: UKR_INSTITUTIONS,
  elections: UKR_ELECTIONS,
  economy: UKR_ECONOMY,
  geography: UKR_GEOGRAPHY,
  eras: UKR_ERAS,
};

export { UKR_IDENTITY } from "./identity";
export { UKR_INSTITUTIONS } from "./institutions";
export { UKR_ELECTIONS } from "./elections";
export { UKR_ECONOMY } from "./economy";
export { UKR_GEOGRAPHY } from "./geography";
export { UKR_ERAS } from "./eras";
