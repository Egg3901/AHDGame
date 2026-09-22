import type { CountryFolder } from "../contract";
import { WAL_IDENTITY } from "./identity";
import { WAL_INSTITUTIONS } from "./institutions";
import { WAL_ELECTIONS } from "./elections";
import { WAL_ECONOMY } from "./economy";
import { WAL_GEOGRAPHY } from "./geography";
import { WAL_ERAS } from "./eras";

/**
 * Wales's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const WAL: CountryFolder = {
  id: "WAL",
  identity: WAL_IDENTITY,
  institutions: WAL_INSTITUTIONS,
  elections: WAL_ELECTIONS,
  economy: WAL_ECONOMY,
  geography: WAL_GEOGRAPHY,
  eras: WAL_ERAS,
};

export { WAL_IDENTITY } from "./identity";
export { WAL_INSTITUTIONS } from "./institutions";
export { WAL_ELECTIONS } from "./elections";
export { WAL_ECONOMY } from "./economy";
export { WAL_GEOGRAPHY } from "./geography";
export { WAL_ERAS } from "./eras";
