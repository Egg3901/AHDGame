import type { CountryFolder } from "../contract";
import { SCO_IDENTITY } from "./identity";
import { SCO_INSTITUTIONS } from "./institutions";
import { SCO_ELECTIONS } from "./elections";
import { SCO_ECONOMY } from "./economy";
import { SCO_GEOGRAPHY } from "./geography";
import { SCO_ERAS } from "./eras";

/**
 * Scotland's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const SCO: CountryFolder = {
  id: "SCO",
  identity: SCO_IDENTITY,
  institutions: SCO_INSTITUTIONS,
  elections: SCO_ELECTIONS,
  economy: SCO_ECONOMY,
  geography: SCO_GEOGRAPHY,
  eras: SCO_ERAS,
};

export { SCO_IDENTITY } from "./identity";
export { SCO_INSTITUTIONS } from "./institutions";
export { SCO_ELECTIONS } from "./elections";
export { SCO_ECONOMY } from "./economy";
export { SCO_GEOGRAPHY } from "./geography";
export { SCO_ERAS } from "./eras";
