import type { CountryFolder } from "../contract";
import { CN_IDENTITY } from "./identity";
import { CN_INSTITUTIONS } from "./institutions";
import { CN_ELECTIONS } from "./elections";
import { CN_ECONOMY } from "./economy";
import { CN_GEOGRAPHY } from "./geography";
import { CN_ERAS } from "./eras";

/**
 * China's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const CN: CountryFolder = {
  id: "CN",
  identity: CN_IDENTITY,
  institutions: CN_INSTITUTIONS,
  elections: CN_ELECTIONS,
  economy: CN_ECONOMY,
  geography: CN_GEOGRAPHY,
  eras: CN_ERAS,
};

export { CN_IDENTITY } from "./identity";
export { CN_INSTITUTIONS } from "./institutions";
export { CN_ELECTIONS } from "./elections";
export { CN_ECONOMY } from "./economy";
export { CN_GEOGRAPHY } from "./geography";
export { CN_ERAS } from "./eras";
