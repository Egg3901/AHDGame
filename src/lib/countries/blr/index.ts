import type { CountryFolder } from "../contract";
import { BLR_IDENTITY } from "./identity";
import { BLR_INSTITUTIONS } from "./institutions";
import { BLR_ELECTIONS } from "./elections";
import { BLR_ECONOMY } from "./economy";
import { BLR_GEOGRAPHY } from "./geography";
import { BLR_ERAS } from "./eras";

/**
 * Belarus's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const BLR: CountryFolder = {
  id: "BLR",
  identity: BLR_IDENTITY,
  institutions: BLR_INSTITUTIONS,
  elections: BLR_ELECTIONS,
  economy: BLR_ECONOMY,
  geography: BLR_GEOGRAPHY,
  eras: BLR_ERAS,
};

export { BLR_IDENTITY } from "./identity";
export { BLR_INSTITUTIONS } from "./institutions";
export { BLR_ELECTIONS } from "./elections";
export { BLR_ECONOMY } from "./economy";
export { BLR_GEOGRAPHY } from "./geography";
export { BLR_ERAS } from "./eras";
