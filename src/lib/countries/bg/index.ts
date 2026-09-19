import type { CountryFolder } from "../contract";
import { BG_IDENTITY } from "./identity";
import { BG_INSTITUTIONS } from "./institutions";
import { BG_ELECTIONS } from "./elections";
import { BG_ECONOMY } from "./economy";
import { BG_GEOGRAPHY } from "./geography";
import { BG_ERAS } from "./eras";

/**
 * Bulgaria's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const BG: CountryFolder = {
  id: "BG",
  identity: BG_IDENTITY,
  institutions: BG_INSTITUTIONS,
  elections: BG_ELECTIONS,
  economy: BG_ECONOMY,
  geography: BG_GEOGRAPHY,
  eras: BG_ERAS,
};

export { BG_IDENTITY } from "./identity";
export { BG_INSTITUTIONS } from "./institutions";
export { BG_ELECTIONS } from "./elections";
export { BG_ECONOMY } from "./economy";
export { BG_GEOGRAPHY } from "./geography";
export { BG_ERAS } from "./eras";
