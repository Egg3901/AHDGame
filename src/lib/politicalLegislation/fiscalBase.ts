/**
 * Fiscal-base readers for the cost engine (design spec §4): national scope is
 * Σ state.gdp / Σ state.population over the country's regions — the general
 * country-page convention. The states collection stores gdp in MILLIONS; the
 * cost engine works in absolute local currency, so this is the one place the
 * unit conversion happens.
 */

import type { Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { FiscalBase } from "./costEngine";

const GDP_MILLIONS = 1_000_000;

export async function countryFiscalBase(db: Db, countryId: string): Promise<FiscalBase> {
  const states = await db
    .collection<State>("states")
    .find({ countryId: countryId as State["countryId"] }, { projection: { gdp: 1, population: 1 } })
    .toArray();
  let gdp = 0;
  let population = 0;
  for (const state of states) {
    gdp += (state.gdp ?? 0) * GDP_MILLIONS;
    population += state.population ?? 0;
  }
  return { gdp, population };
}

export async function regionFiscalBase(db: Db, regionId: string): Promise<FiscalBase> {
  const state = await db
    .collection<State>("states")
    .findOne({ _id: regionId }, { projection: { gdp: 1, population: 1 } });
  return {
    gdp: (state?.gdp ?? 0) * GDP_MILLIONS,
    population: state?.population ?? 0,
  };
}
