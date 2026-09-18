import type { CountryFolder } from "../contract";
import { US_IDENTITY } from "./identity";
import { US_INSTITUTIONS } from "./institutions";
import { US_ELECTIONS } from "./elections";
import { US_ECONOMY } from "./economy";
import { US_GEOGRAPHY } from "./geography";
import { US_ERAS } from "./eras";

/**
 * The United States' country folder.
 *
 * ⚠️⚠️ SERVER-SIDE CONSUMERS ONLY. This barrel composes the whole folder, and
 * `./elections` reaches `getDb` through `ensurePresidentialElection`. A
 * `"use client"` component importing this pulls the MongoDB driver into the
 * browser bundle. Client surfaces must import the one narrow module they need --
 * `./identity` for labels, `./geographyFacts` for a continent or an ISO code --
 * never this file, and never `./geography`, which carries every era of census
 * and metric data.
 *
 * `noClientBarrelImport.test.ts` enforces that, because the architecture audit's
 * client-to-server check covers the getDb half but not the bundle-size half.
 *
 * WHAT THIS IS FOR. Registries forward to the modules below, so nothing in the
 * app needs to read this object. It exists so the shape can be asserted:
 * `contract.test.ts` checks that a country satisfies `CountryFolder` with
 * nothing quietly absent. For the US that check earns its keep -- it is the
 * first PRESIDENTIAL country and the first that is anybody's DEFAULT, and three
 * contract fields had to become optional to admit it.
 */
export const US: CountryFolder = {
  id: "US",
  identity: US_IDENTITY,
  institutions: US_INSTITUTIONS,
  elections: US_ELECTIONS,
  economy: US_ECONOMY,
  geography: US_GEOGRAPHY,
  eras: US_ERAS,
};

export { US_IDENTITY } from "./identity";
export { US_INSTITUTIONS } from "./institutions";
export { US_ELECTIONS } from "./elections";
export { US_ECONOMY } from "./economy";
export { US_GEOGRAPHY } from "./geography";
export { US_ERAS } from "./eras";
