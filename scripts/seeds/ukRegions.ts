/**
 * UK Regions Seed Data
 *
 * Four UK regions for Commons elections:
 * - England (543 seats)
 * - Scotland (59 seats)
 * - Wales (40 seats)
 * - Northern Ireland (18 seats)
 *
 * Population/GDP data approximated from 2019 UK statistics
 */

import type { State } from "../../src/lib/db/types";

export const ukRegions: State[] = [
  {
    _id: "ENG",
    countryId: "UK",
    regionType: "nation",
    name: "England",
    population: 56550000, // ~84% of UK population (67M total)
    gdp: 2200000, // ~85% of UK GDP (£2.6T total) in millions
    houseDistricts: 543, // Commons seats for England
    stateSenateSeats: 299, // Sum of all English regional council seats
    region: "England",
  },
  {
    _id: "SCO",
    countryId: "UK",
    regionType: "nation",
    name: "Scotland",
    population: 5460000, // ~8.2% of UK population
    gdp: 180000, // ~7% of UK GDP in millions
    houseDistricts: 59, // Commons seats for Scotland
    stateSenateSeats: 32,
    region: "Scotland",
  },
  {
    _id: "WAL",
    countryId: "UK",
    regionType: "nation",
    name: "Wales",
    population: 3140000, // ~4.7% of UK population
    gdp: 75000, // ~3% of UK GDP in millions
    houseDistricts: 40, // Commons seats for Wales
    stateSenateSeats: 22,
    region: "Wales",
  },
  {
    _id: "NIR",
    countryId: "UK",
    regionType: "nation",
    name: "Northern Ireland",
    population: 1890000, // ~2.8% of UK population
    gdp: 50000, // ~2% of UK GDP in millions
    houseDistricts: 18, // Commons seats for Northern Ireland
    stateSenateSeats: 11,
    region: "Northern Ireland",
  },
];
