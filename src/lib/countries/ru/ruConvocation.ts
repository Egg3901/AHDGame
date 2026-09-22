import type { Db } from "mongodb";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { resetParliamentaryGovernmentAfterElection } from "@/lib/turn/parliamentaryGovernment";
import { getCountryConfig, getHeadOfStateOfficeType } from "@/lib/constants/countries";

/**
 * RU convocation reset — fires once when the last supremeSovietDeputy election
 * of a cycle resolves (spec §2.4). Each convocation re-opens the Premier (and,
 * from Phase 4b, the Chairman of the Presidium) for reappointment.
 *
 * Guard: the formation's recorded cycle must be behind the resolving election
 * cycle. `resetParliamentaryGovernmentAfterElection` increments the formation
 * cycle, so a second same-turn caller sees cycle >= electionCycle + 1 and
 * no-ops — this makes the destructive reset idempotent where CN's chair
 * opener is naturally so.
 *
 * The generic reset routes an NPP-held premiership (pmNppId — the seeded
 * D5 start) through the vacate path, which is exactly the convocation
 * semantics: the office re-opens for appointment by the new chamber.
 *
 * One-party states cannot snap: the generic reset arms pmVacancyDeadlineTurn
 * (the parliamentary auto-snap watchdog), which must be disarmed for RU.
 */
export async function handleRuConvocationReset(
  db: Db,
  electionCycle: number,
  now: Date
): Promise<void> {
  const govColl = db.collection<GovernmentFormation>("governmentFormations");
  const gov = await govColl.findOne({ _id: "RU" });
  if ((gov?.cycle ?? 0) >= electionCycle + 1) return; // already reset for this convocation

  await resetParliamentaryGovernmentAfterElection(db, "RU", now);

  await govColl.updateOne({ _id: "RU" }, { $set: { pmVacancyDeadlineTurn: null, updatedAt: now } });

  // Each convocation re-elects the Chairman of the Presidium (§2.4): clear the
  // formation linkage and unseat the head-of-state row so the new chamber
  // appoints afresh (PM-vacate parity).
  await govColl.updateOne(
    { _id: "RU" },
    { $set: { hosCharacterId: null, hosNppId: null, hosName: null, updatedAt: now } }
  );
  const hosOfficeType = getHeadOfStateOfficeType(getCountryConfig("RU"));
  if (hosOfficeType) {
    await db
      .collection("electedOfficials")
      .deleteMany({ countryId: "RU", officeType: hosOfficeType });
  }
}
