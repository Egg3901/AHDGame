import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ReadinessCheck } from "@/lib/constants/countryReadinessExpectations";

/**
 * Every country expects a `governmentFormations` doc keyed by its country id.
 *
 * ⚠️ LIVES IN ITS OWN MODULE TO BREAK A CYCLE. It was module-private in
 * `countryReadinessExpectations.ts`. Japan's expectations moved to
 * `countries/jp/institutions.ts` and its `extras` entry calls this, but the
 * registry imports those expectations -- so importing the check back out of the
 * registry would be a real runtime import cycle.
 *
 * ⚠️ MISSING IS AN ERROR, NOT A WARNING. A country with no formation doc has no
 * government at all, which is why this reports "missing" rather than degrading
 * to a warning the way an empty-but-present roster does.
 */
export async function checkGovernmentFormation(
  countryId: CountryId,
  db: Db,
  options: { createdOnFirstTurn?: boolean } = {}
): Promise<ReadinessCheck> {
  const gov = await db
    .collection<{ _id: string; status?: string; cycle?: number }>("governmentFormations")
    .findOne({ _id: countryId });
  if (gov) {
    return {
      name: "GovernmentFormation",
      status: "ok",
      detail: `Status: ${gov.status}, cycle: ${gov.cycle}`,
    };
  }

  // ⚠ SOME COUNTRIES SEED THIS ROW LAZILY, so "absent" is only a fault once a
  // turn has had the chance to create it. The UK is the one that does:
  // `updateGovernmentSeats` calls its own `seedGovernmentFormation` on the first
  // run that finds no document, reading legacy `ukGovernment` /
  // `parliamentaryGovernments` collections that no seed file has. Every other
  // country writes the row at seed time.
  //
  // Reported "missing" flatly, this made a correct reset look broken: a freshly
  // reset world sits on turn 1 with no turn processed, which is exactly when the
  // row cannot exist yet.
  if (options.createdOnFirstTurn) {
    const gs = await db
      .collection<{ currentTurn?: number }>("gameState")
      .findOne({ _id: "current" as never });
    const turn = typeof gs?.currentTurn === "number" ? gs.currentTurn : 1;
    if (turn <= 1) {
      return {
        name: "GovernmentFormation",
        status: "ok",
        detail: `Created on the first processed turn (world is on turn ${turn})`,
      };
    }
    return {
      name: "GovernmentFormation",
      // A turn HAS run and the row still is not there, so the lazy path did not
      // fire. That is a real fault, not a timing artefact.
      status: "missing",
      detail: `No ${countryId} governmentFormations doc after turn ${turn}; the first-turn seed did not run`,
    };
  }

  return {
    name: "GovernmentFormation",
    status: "missing",
    detail: `No ${countryId} governmentFormations doc`,
  };
}
