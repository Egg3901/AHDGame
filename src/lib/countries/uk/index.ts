import type { CountryFolder } from "../contract";
import { UK_IDENTITY } from "./identity";
import { UK_INSTITUTIONS } from "./institutions";
import { UK_ELECTIONS } from "./elections";
import { UK_ECONOMY } from "./economy";
import { UK_GEOGRAPHY } from "./geography";
import { UK_ERAS } from "./eras";

/**
 * the United Kingdom's country folder.
 *
 * ⚠⚠ SERVER-SIDE CONSUMERS ONLY. `./elections` reaches `getDb` through the
 * continuity spawners, so a `"use client"` component importing this pulls the
 * MongoDB driver into the browser. Client surfaces take `./identity` or
 * `./geographyFacts`, never this file and never `./geography`.
 */
export const UK: CountryFolder = {
  id: "UK",
  identity: UK_IDENTITY,
  institutions: UK_INSTITUTIONS,
  elections: UK_ELECTIONS,
  economy: UK_ECONOMY,
  geography: UK_GEOGRAPHY,
  eras: UK_ERAS,
};

export { UK_IDENTITY } from "./identity";
export { UK_INSTITUTIONS } from "./institutions";
export { UK_ELECTIONS } from "./elections";
export { UK_ECONOMY } from "./economy";
export { UK_GEOGRAPHY } from "./geography";
export { UK_ERAS } from "./eras";
