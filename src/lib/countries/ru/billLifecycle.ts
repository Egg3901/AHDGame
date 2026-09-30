/**
 * Russian bills follow the active Union, Congress or Federal Assembly.
 * processRUBillLifecycle keeps the older one-party rules in other eras and
 * prevents a dissolved legislature from enacting or advancing bills.
 */
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { loadRuntimeCountryOffices } from "@/lib/countries/runtimeOffices";
import { buildConfiguredCountryBillLifecycle } from "../../turn/billLifecycle/configs/configuredCountry";
import { runBillLifecycle } from "../../turn/billLifecycle/engine";

export async function processRussian1991Bills(db: Db, now: Date, currentTurn: number) {
  const offices = await loadRuntimeCountryOffices(db, "RU", "1991-default");
  if (
    offices.config.legislature.lowerChamber.elected === false ||
    offices.config.legislature.lowerChamber.seats < 1
  )
    return { enacted: 0, failed: 0 };
  const result = await runBillLifecycle(
    db,
    buildConfiguredCountryBillLifecycle("RU", "1991-default", offices.config),
    now,
    currentTurn
  );
  return { enacted: result.billsPassed, failed: result.billsFailed };
}

export async function processRUBillLifecycle(
  now: Date
): Promise<{ enacted: number; failed: number }> {
  const db = await getDb();
  const state = await getGameState(db);
  if (state?.preset !== "1991-default") {
    const { processOnePartyBillLifecycleForCountry } =
      await import("../../turn/onePartyBillLifecycle");
    return processOnePartyBillLifecycleForCountry("RU", now);
  }
  return processRussian1991Bills(db, now, state.currentTurn ?? 1);
}
