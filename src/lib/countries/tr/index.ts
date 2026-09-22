import type { CountryFolder } from "../contract";
import { TR_IDENTITY } from "./identity";
import { TR_INSTITUTIONS } from "./institutions";
import { TR_ELECTIONS } from "./elections";
import { TR_ECONOMY } from "./economy";
import { TR_GEOGRAPHY } from "./geography";
import { TR_ERAS } from "./eras";

/**
 * Turkey's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const TR: CountryFolder = {
  id: "TR",
  identity: TR_IDENTITY,
  institutions: TR_INSTITUTIONS,
  elections: TR_ELECTIONS,
  economy: TR_ECONOMY,
  geography: TR_GEOGRAPHY,
  eras: TR_ERAS,
};

export { TR_IDENTITY } from "./identity";
export { TR_INSTITUTIONS } from "./institutions";
export { TR_ELECTIONS } from "./elections";
export { TR_ECONOMY } from "./economy";
export { TR_GEOGRAPHY } from "./geography";
export { TR_ERAS } from "./eras";
