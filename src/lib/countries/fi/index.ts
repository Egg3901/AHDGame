import type { CountryFolder } from "../contract";
import { FI_IDENTITY } from "./identity";
import { FI_INSTITUTIONS } from "./institutions";
import { FI_ELECTIONS } from "./elections";
import { FI_ECONOMY } from "./economy";
import { FI_GEOGRAPHY } from "./geography";
import { FI_ERAS } from "./eras";

/**
 * Finland's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const FI: CountryFolder = {
  id: "FI",
  identity: FI_IDENTITY,
  institutions: FI_INSTITUTIONS,
  elections: FI_ELECTIONS,
  economy: FI_ECONOMY,
  geography: FI_GEOGRAPHY,
  eras: FI_ERAS,
};

export { FI_IDENTITY } from "./identity";
export { FI_INSTITUTIONS } from "./institutions";
export { FI_ELECTIONS } from "./elections";
export { FI_ECONOMY } from "./economy";
export { FI_GEOGRAPHY } from "./geography";
export { FI_ERAS } from "./eras";
