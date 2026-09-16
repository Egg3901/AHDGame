import type { CountryFolder } from "../contract";
import { JP_IDENTITY } from "./identity";
import { JP_INSTITUTIONS } from "./institutions";
import { JP_ELECTIONS } from "./elections";
import { JP_ECONOMY } from "./economy";
import { JP_GEOGRAPHY } from "./geography";
import { JP_ERAS } from "./eras";

/**
 * Japan's country folder.
 *
 * ⚠️⚠️ SERVER-SIDE CONSUMERS ONLY. This barrel composes the whole folder, and
 * `./elections` reaches `getDb` through the perpetual-election spawners. A
 * `"use client"` component importing this pulls the MongoDB driver into the
 * browser bundle. Client surfaces must import the one narrow module they need --
 * `./identity` for labels, `./geography` for regions -- never this file.
 *
 * `noClientBarrelImport.test.ts` enforces that, because the architecture audit's
 * client-to-server check covers the getDb half but not the bundle-size half.
 *
 * WHAT THIS IS FOR. Every registry Japan appears in already forwards to the
 * modules below, so nothing in the app needs to read this object. It exists so
 * the shape can be asserted: `contract.test.ts` checks that Japan satisfies
 * `CountryFolder` with nothing quietly absent, which is the check that tells the
 * next country whether the contract is actually expressible.
 */
export const JP: CountryFolder = {
  id: "JP",
  identity: JP_IDENTITY,
  institutions: JP_INSTITUTIONS,
  elections: JP_ELECTIONS,
  economy: JP_ECONOMY,
  geography: JP_GEOGRAPHY,
  eras: JP_ERAS,
};

export { JP_IDENTITY } from "./identity";
export { JP_INSTITUTIONS } from "./institutions";
export { JP_ELECTIONS } from "./elections";
export { JP_ECONOMY } from "./economy";
export { JP_GEOGRAPHY } from "./geography";
export { JP_ERAS } from "./eras";

export type {
  CountryElections,
  CountryEconomy,
  CountryEraOverride,
  CountryFolder,
  CountryGeography,
  CountryIdentity,
  CountryInstitutions,
} from "../contract";
