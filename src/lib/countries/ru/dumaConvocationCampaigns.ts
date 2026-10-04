/**
 * Later Duma campaigns renew the lower chamber through the native ballot pipeline.
 * processRussianDumaConvocationCampaigns resumes one bound campaign, admits slates
 * and opens only failed-ballot repeats within that convocation's original term.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryGameState } from "@/lib/db/types";
import type { RussianConstitutionalCalendar } from "./constitutionalProposals";
import { openRussianDumaConvocation } from "./dumaConvocationOpening";
import {
  loadRussianDumaAuthority,
  RUSSIAN_DUMA_AUTHORITY_PROJECTION,
} from "./dumaConvocationAuthority";
import { admitRussianDumaNpcNominees } from "./dumaNpcAdmission";
import { admitRussianDumaRepeatNpcNominees } from "./dumaRepeatNpcAdmission";
import {
  openRussianDumaRepeat,
  RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION,
  type RussianDumaRepeatOpeningRecord,
} from "./dumaRepeatOpening";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import { planRussianAssemblyCampaign } from "./rules/assemblyCampaign";
export async function processRussianDumaConvocationCampaigns(input: {
  db: Db;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
}) {
  const result = { active: false, opened: 0, repeatsOpened: 0, npcCandidatesCreated: 0 };
  const { db, turn, now } = input;
  if (input.game.preset !== "1991-default") return result;
  const opened = await openRussianDumaConvocation(input);
  if (opened?.created) result.opened++;
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne(
      { _id: "RU" },
      { projection: { ...RUSSIAN_DUMA_AUTHORITY_PROJECTION, ruDumaNpcAdmissionCohortId: 1 } }
    );
  const root = country?.ruDumaConvocationCohortId;
  if (!country || !root) return result;
  result.active = true;
  const authority = await loadRussianDumaAuthority({ db, country, root, turn });
  if (!authority?.record) throw new Error("Duma campaign lacks its current convocation authority");
  const latest = await db
    .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
    .findOne(
      {
        countryId: "RU",
        preset: "1991-default",
        mandateSinceTurn: country.ruFederalAssemblyMandateSinceTurn,
        $or: [{ cohortId: root }, { rootCohortId: root }],
      },
      {
        sort: { generation: -1 },
        projection: {
          cohortId: 1,
          generation: 1,
          resolvedOnTurn: 1,
          "result.constituencyResults.decision.outcome": 1,
          "result.listDecision.outcome": 1,
        },
      }
    );
  const failedPolls = latest
    ? latest.result.constituencyResults.filter((row) => row.decision.outcome === "repeat").length +
      (latest.result.listDecision.outcome === "repeat" ? 1 : 0)
    : 0;
  const generation = latest ? (latest.generation ?? 0) + 1 : 0;
  const opening =
    latest && failedPolls
      ? await db
          .collection<RussianDumaRepeatOpeningRecord>(RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION)
          .findOne(
            {
              _id: `${root.toHexString()}:repeat:${generation}`,
            },
            { projection: { cohortId: 1, generation: 1, openedOnTurn: 1, npcAdmission: 1 } }
          )
      : null;
  const plan = planRussianAssemblyCampaign({
    turn,
    rootId: root.toHexString(),
    activeAssembly: authority.record.seatedOnTurn != null,
    originalTermEndTurn: authority.record.termEndTurn,
    firstNpcAdmitted: country.ruDumaNpcAdmissionCohortId?.equals(root) ?? false,
    latestResult: latest
      ? { generation: latest.generation ?? 0, resolvedOnTurn: latest.resolvedOnTurn, failedPolls }
      : undefined,
    nextOpening: opening
      ? {
          generation: opening.generation,
          openedOnTurn: opening.openedOnTurn,
          npcAdmitted: opening.npcAdmission != null,
        }
      : undefined,
  });
  if (plan.admitFirst) {
    const admitted = await admitRussianDumaNpcNominees({ db, cohortId: root, turn, now });
    result.npcCandidatesCreated += admitted?.created ?? 0;
  }
  let repeatCohort: ObjectId | undefined;
  if (plan.openRepeatGeneration != null && latest) {
    const repeat = await openRussianDumaRepeat({
      db,
      rootCohortId: root,
      previousResultId: latest.cohortId.toHexString(),
      turn,
      now,
    });
    if (repeat?.created) result.repeatsOpened++;
    repeatCohort = repeat?.record.cohortId;
  }
  const admitGeneration = plan.admitRepeatGeneration ?? (repeatCohort ? generation : null);
  if (admitGeneration != null) {
    const admitted = await admitRussianDumaRepeatNpcNominees({
      db,
      rootCohortId: root,
      generation: admitGeneration,
      turn,
      now,
    });
    result.npcCandidatesCreated += admitted?.created ?? 0;
  }
  return result;
}
