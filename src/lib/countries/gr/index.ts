import type { CountryFolder } from "../contract";
import { GR_IDENTITY } from "./identity";
import { GR_INSTITUTIONS } from "./institutions";
import { GR_ELECTIONS } from "./elections";
import { GR_ECONOMY } from "./economy";
import { GR_GEOGRAPHY } from "./geography";
import { GR_ERAS } from "./eras";

/**
 * Greece's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const GR: CountryFolder = {
  id: "GR",
  identity: GR_IDENTITY,
  institutions: GR_INSTITUTIONS,
  elections: GR_ELECTIONS,
  economy: GR_ECONOMY,
  geography: GR_GEOGRAPHY,
  eras: GR_ERAS,
};

export { GR_IDENTITY } from "./identity";
export { GR_INSTITUTIONS } from "./institutions";
export { GR_ELECTIONS } from "./elections";
export { GR_ECONOMY } from "./economy";
export { GR_GEOGRAPHY } from "./geography";
export { GR_ERAS } from "./eras";
