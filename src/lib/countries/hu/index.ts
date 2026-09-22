import type { CountryFolder } from "../contract";
import { HU_IDENTITY } from "./identity";
import { HU_INSTITUTIONS } from "./institutions";
import { HU_ELECTIONS } from "./elections";
import { HU_ECONOMY } from "./economy";
import { HU_GEOGRAPHY } from "./geography";
import { HU_ERAS } from "./eras";

/**
 * Hungary's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const HU: CountryFolder = {
  id: "HU",
  identity: HU_IDENTITY,
  institutions: HU_INSTITUTIONS,
  elections: HU_ELECTIONS,
  economy: HU_ECONOMY,
  geography: HU_GEOGRAPHY,
  eras: HU_ERAS,
};

export { HU_IDENTITY } from "./identity";
export { HU_INSTITUTIONS } from "./institutions";
export { HU_ELECTIONS } from "./elections";
export { HU_ECONOMY } from "./economy";
export { HU_GEOGRAPHY } from "./geography";
export { HU_ERAS } from "./eras";
