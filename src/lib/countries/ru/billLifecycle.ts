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
import { passesRussianDumaLawChamber } from "./rules/dumaElectoralLaw";
import { passesRussianCouncilFormationLaw } from "./rules/councilComposition";
import { passesRussianConstitutionalDecision } from "./rules/constitutionalDecisions";

export async function processRussian1991Bills(db: Db, now: Date, currentTurn: number) {
  const offices = await loadRuntimeCountryOffices(db, "RU", "1991-default");
  if (
    offices.config.legislature.lowerChamber.elected === false ||
    offices.config.legislature.lowerChamber.seats < 1
  )
    return { enacted: 0, failed: 0 };
  const lifecycle = buildConfiguredCountryBillLifecycle("RU", "1991-default", offices.config);
  for (const stage of lifecycle.stages) {
    if (stage.kind !== "chamberVote") continue;
    stage.passCheck = (bill, totals) => {
      if (
        !bill.russianConstitutionalMandate &&
        !bill.russianCouncilFormationMandate &&
        !bill.russianDumaElectoralMandate
      )
        return undefined;
      if (
        [
          bill.russianConstitutionalMandate,
          bill.russianCouncilFormationMandate,
          bill.russianDumaElectoralMandate,
        ].filter(Boolean).length !== 1
      )
        return false;
      const office = stage.officeTypeFor(bill);
      const seats =
        office === offices.lowerOfficeType
          ? offices.config.legislature.lowerChamber.seats
          : office === offices.upperOfficeType
            ? offices.config.legislature.upperChamber?.seats
            : undefined;
      return (
        seats != null &&
        (bill.russianDumaElectoralMandate
          ? passesRussianDumaLawChamber(totals, seats)
          : bill.russianCouncilFormationMandate
            ? passesRussianCouncilFormationLaw(totals.for, seats)
            : passesRussianConstitutionalDecision(totals.for, seats))
      );
    };
  }
  const result = await runBillLifecycle(db, lifecycle, now, currentTurn);
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
