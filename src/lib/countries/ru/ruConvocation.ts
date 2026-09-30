/**
 * A Russian legislature election reopens government formation once per cycle.
 * handleRuConvocationReset follows the active chamber and only vacates a
 * legislature-appointed head of state; direct presidents keep their mandate.
 */
import type { Db } from "mongodb";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { resetParliamentaryGovernmentAfterElection } from "@/lib/turn/parliamentaryGovernment";
import { loadRuntimeCountryOffices } from "@/lib/countries/runtimeOffices";

export async function handleRuConvocationReset(
  db: Db,
  electionCycle: number,
  now: Date,
  electionType = "supremeSovietDeputy"
): Promise<void> {
  const offices = await loadRuntimeCountryOffices(db, "RU");
  if (
    offices.config.legislature.lowerChamber.elected === false ||
    offices.config.legislature.lowerChamber.seats < 1
  )
    return;
  const regularType = electionType.startsWith("snap_") ? electionType.slice(5) : electionType;
  if (![offices.lowerOfficeType, offices.config.legislature.lowerChamber.key].includes(regularType))
    return;
  const govColl = db.collection<GovernmentFormation>("governmentFormations");
  const gov = await govColl.findOne({ _id: "RU" });
  if ((gov?.cycle ?? 0) >= electionCycle + 1) return; // already reset for this convocation

  await resetParliamentaryGovernmentAfterElection(db, "RU", now);

  if (offices.config.governmentType === "onePartyState") {
    await govColl.updateOne(
      { _id: "RU" },
      { $set: { pmVacancyDeadlineTurn: null, updatedAt: now } }
    );
  }
  // A directly elected president retains a separate mandate when the chamber changes.
  if (offices.config.headOfStateSelection !== "legislatureAppointment") return;

  // Each convocation re-elects the Chairman of the Presidium (§2.4): clear the
  // formation linkage and unseat the head-of-state row so the new chamber
  // appoints afresh (PM-vacate parity).
  await govColl.updateOne(
    { _id: "RU" },
    { $set: { hosCharacterId: null, hosNppId: null, hosName: null, updatedAt: now } }
  );
  const hosOfficeType = offices.headOfStateOfficeType;
  if (hosOfficeType) {
    await db
      .collection("electedOfficials")
      .deleteMany({ countryId: "RU", officeType: hosOfficeType });
    for (const collection of ["characters", "npps"]) {
      await db
        .collection(collection)
        .updateMany(
          { countryId: "RU", "currentOffice.type": hosOfficeType },
          { $set: { currentOffice: null, updatedAt: now } }
        );
    }
  }
}
