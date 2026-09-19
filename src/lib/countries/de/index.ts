import type { CountryFolder } from "../contract";
import { DE_IDENTITY } from "./identity";
import { DE_INSTITUTIONS } from "./institutions";
import { DE_ELECTIONS } from "./elections";
import { DE_ECONOMY } from "./economy";
import { DE_GEOGRAPHY } from "./geography";
import { DE_ERAS } from "./eras";

/**
 * Germany's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const DE: CountryFolder = {
  id: "DE",
  identity: DE_IDENTITY,
  institutions: DE_INSTITUTIONS,
  elections: DE_ELECTIONS,
  economy: DE_ECONOMY,
  geography: DE_GEOGRAPHY,
  eras: DE_ERAS,
};

export { DE_IDENTITY } from "./identity";
export { DE_INSTITUTIONS } from "./institutions";
export { DE_ELECTIONS } from "./elections";
export { DE_ECONOMY } from "./economy";
export { DE_GEOGRAPHY } from "./geography";
export { DE_ERAS } from "./eras";
