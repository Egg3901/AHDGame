import type { CountryFolder } from "../contract";
import { DD_IDENTITY } from "./identity";
import { DD_INSTITUTIONS } from "./institutions";
import { DD_ELECTIONS } from "./elections";
import { DD_ECONOMY } from "./economy";
import { DD_GEOGRAPHY } from "./geography";
import { DD_ERAS } from "./eras";

/**
 * East Germany's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const DD: CountryFolder = {
  id: "DD",
  identity: DD_IDENTITY,
  institutions: DD_INSTITUTIONS,
  elections: DD_ELECTIONS,
  economy: DD_ECONOMY,
  geography: DD_GEOGRAPHY,
  eras: DD_ERAS,
};

export { DD_IDENTITY } from "./identity";
export { DD_INSTITUTIONS } from "./institutions";
export { DD_ELECTIONS } from "./elections";
export { DD_ECONOMY } from "./economy";
export { DD_GEOGRAPHY } from "./geography";
export { DD_ERAS } from "./eras";
