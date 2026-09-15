/**
 * Japan's country folder.
 *
 * ⚠️ SERVER-SIDE CONSUMERS ONLY. This barrel will re-export the whole folder,
 * including modules that reach seeds and database types. A "use client"
 * component importing it pulls all of that into the browser bundle. Client
 * surfaces must import the one narrow module they need, not this file.
 *
 * EMPTY BY DESIGN. D1 builds the contract, the snapshot and the harness;
 * nothing has moved yet. D2 onward add one subject at a time:
 *
 *   D2  identity.ts      names, labels, seals, surfaces
 *   D3  institutions.ts  cabinet, legislature, military
 *       elections.ts     phases, spawn handlers, seat tables
 *   D4  economy.ts       currency, monetary, sector weights, tax
 *   D5  geography.ts     regions, adjacency, census, demographics
 *   D6  data/            the relocated seeds/jp/** payloads
 *       eras/*.ts        all seven shipping presets
 *
 * Which files each phase touches is tracked in ../jpCoverage.ts, not here.
 */

export type {
  CountryElections,
  CountryEconomy,
  CountryEraOverride,
  CountryFolder,
  CountryGeography,
  CountryIdentity,
  CountryInstitutions,
} from "../contract";
