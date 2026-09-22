import type { CountryFolder } from "../contract";
import { YU_IDENTITY } from "./identity";
import { YU_INSTITUTIONS } from "./institutions";
import { YU_ELECTIONS } from "./elections";
import { YU_ECONOMY } from "./economy";
import { YU_GEOGRAPHY } from "./geography";
import { YU_ERAS } from "./eras";

/**
 * Yugoslavia's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const YU: CountryFolder = {
  id: "YU",
  identity: YU_IDENTITY,
  institutions: YU_INSTITUTIONS,
  elections: YU_ELECTIONS,
  economy: YU_ECONOMY,
  geography: YU_GEOGRAPHY,
  eras: YU_ERAS,
};

export { YU_IDENTITY } from "./identity";
export { YU_INSTITUTIONS } from "./institutions";
export { YU_ELECTIONS } from "./elections";
export { YU_ECONOMY } from "./economy";
export { YU_GEOGRAPHY } from "./geography";
export { YU_ERAS } from "./eras";
