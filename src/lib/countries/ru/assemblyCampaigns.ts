/**
 * Ratified Russian Assembly decisions start native campaigns during the turn.
 * processRussianAssemblyCampaigns opens first and failed-poll repeat families,
 * then admits Duma slates before Council slates to keep their profiles disjoint.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryGameState } from "@/lib/db/types";
import type { RussianConstitutionalCalendar } from "./constitutionalProposals";
import { processRussianDumaConvocationCampaigns } from "./dumaConvocationCampaigns";
import { calendarTurn } from "@/lib/utils/gameDate";
import { ru1993LegislatureStage } from "./eras/1991";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
import { planRussianDumaConvocation } from "./rules/dumaConvocation";
import { planRussianAssemblyCampaign } from "./rules/assemblyCampaign";
import { openRussianDumaElection } from "./dumaElectionOpening";
import {
  openRussianCouncilElection,
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION,
  type RussianCouncilOpeningRecord,
} from "./councilElectionOpening";
import {
  openRussianDumaRepeat,
  RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION,
  type RussianDumaRepeatOpeningRecord,
} from "./dumaRepeatOpening";
import { openRussianCouncilRepeat } from "./councilRepeatOpening";
import { admitRussianDumaNpcNominees } from "./dumaNpcAdmission";
import { admitRussianDumaRepeatNpcNominees } from "./dumaRepeatNpcAdmission";
import { admitRussianCouncilNpcNominees } from "./councilNpcAdmission";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import {
  RUSSIAN_COUNCIL_RESULTS_COLLECTION,
  type RussianCouncilResultRecord,
} from "./councilElectionResult";
import {
  RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION,
  type RussianAssemblySeatingRecord,
} from "./assemblySeating";

export async function processRussianAssemblyCampaigns(input: {
  db: Db;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
}) {
  const { db, game, turn, now } = input;
  const result = {
    firstOpened: 0,
    convocationsOpened: 0,
    repeatsOpened: 0,
    npcCandidatesCreated: 0,
  };
  if (
    game.preset !== "1991-default" ||
    ru1993LegislatureStage(
      calendarTurn(turn, {
        preIterationActive: game.preIteration?.active,
        preIterationTurns: game.preIterationTurns,
      })
    ) === "congress"
  )
    return result;
  const country = await db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFirstDumaElectionCohortId: 1,
        ruFirstCouncilElectionCohortId: 1,
        ruFederalAssemblySinceTurn: 1,
        ruDumaNpcAdmissionCohortId: 1,
        ruDumaConvocationCohortId: 1,
      },
    }
  );
  if (
    !country ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return result;
  const activeAssembly = country.ruFederalAssemblySinceTurn != null;
  let dumaRoot = country.ruFirstDumaElectionCohortId;
  let councilRoot = country.ruFirstCouncilElectionCohortId;
  let seating: RussianAssemblySeatingRecord | null = null;
  if (activeAssembly) {
    // Legacy alternate settlements have no native roots. Preserve their offices
    // rather than inventing a new first election behind the existing marker.
    if (!dumaRoot || !councilRoot) return result;
    seating = await db
      .collection<RussianAssemblySeatingRecord>(RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION)
      .findOne(
        { _id: `${dumaRoot.toHexString()}:${councilRoot.toHexString()}` },
        {
          projection: {
            countryId: 1,
            preset: 1,
            dumaRootCohortId: 1,
            councilRootCohortId: 1,
            seatedOnTurn: 1,
            dumaTermEndTurn: 1,
            councilTermEndTurn: 1,
          },
        }
      );
    if (
      !seating ||
      seating.countryId !== "RU" ||
      seating.preset !== "1991-default" ||
      !seating.dumaRootCohortId.equals(dumaRoot) ||
      !seating.councilRootCohortId.equals(councilRoot) ||
      seating.seatedOnTurn !== country.ruFederalAssemblySinceTurn ||
      seating.seatedOnTurn > turn ||
      !Number.isSafeInteger(seating.dumaTermEndTurn) ||
      !Number.isSafeInteger(seating.councilTermEndTurn) ||
      seating.dumaTermEndTurn <= seating.seatedOnTurn ||
      seating.councilTermEndTurn <= seating.seatedOnTurn
    )
      throw new Error("Active Assembly campaigns need their immutable term journal");
  }
  const ordinaryDue =
    !!country.ruDumaConvocationCohortId ||
    (seating &&
      planRussianDumaConvocation({
        turn,
        current: {
          number: 1,
          rootId: dumaRoot!.toHexString(),
          seatedOnTurn: seating.seatedOnTurn,
          termEndTurn: seating.dumaTermEndTurn,
        },
      }).kind === "open");
  const ordinary =
    activeAssembly && ordinaryDue ? await processRussianDumaConvocationCampaigns(input) : null;
  result.convocationsOpened += ordinary?.opened ?? 0;
  result.repeatsOpened += ordinary?.repeatsOpened ?? 0;
  result.npcCandidatesCreated += ordinary?.npcCandidatesCreated ?? 0;
  // Open both first families before admission. Duma admission reserves its
  // profiles before the Council chooses from the remaining national pool.
  if (!dumaRoot) {
    const opened = await openRussianDumaElection(input);
    if (!opened) return result;
    dumaRoot = opened.cohortId;
    if (opened.created) result.firstOpened++;
  }
  if (!councilRoot) {
    const opened = await openRussianCouncilElection(input);
    if (!opened) return result;
    councilRoot = opened.cohortId;
    if (opened.created) result.firstOpened++;
  }
  for (const chamber of ["duma", "council"] as const) {
    if (chamber === "duma" && ordinary?.active) continue;
    const root: ObjectId = chamber === "duma" ? dumaRoot : councilRoot;
    const familyFilter = {
      countryId: "RU" as const,
      preset: "1991-default" as const,
      mandateSinceTurn: country.ruFederalAssemblyMandateSinceTurn,
      $or: [{ cohortId: root }, { rootCohortId: root }],
    };
    const latest =
      chamber === "duma"
        ? await db
            .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
            .findOne(familyFilter, {
              sort: { generation: -1 },
              projection: {
                cohortId: 1,
                generation: 1,
                resolvedOnTurn: 1,
                "result.constituencyResults.decision.outcome": 1,
                "result.listDecision.outcome": 1,
              },
            })
        : await db
            .collection<RussianCouncilResultRecord>(RUSSIAN_COUNCIL_RESULTS_COLLECTION)
            .findOne(familyFilter, {
              sort: { generation: -1 },
              projection: {
                cohortId: 1,
                generation: 1,
                resolvedOnTurn: 1,
                "result.decision.outcome": 1,
              },
            });
    const failedPolls = !latest
      ? 0
      : chamber === "duma"
        ? (latest as RussianDumaResultRecord).result.constituencyResults.filter(
            (row) => row.decision.outcome === "repeat"
          ).length +
          ((latest as RussianDumaResultRecord).result.listDecision.outcome === "repeat" ? 1 : 0)
        : (latest as RussianCouncilResultRecord).result.filter(
            (row) => row.decision.outcome === "repeat"
          ).length;
    const generation = latest ? (latest.generation ?? 0) + 1 : 0;
    const id = latest ? `${root.toHexString()}:repeat:${generation}` : root.toHexString();
    let opening: RussianDumaRepeatOpeningRecord | RussianCouncilOpeningRecord | null = null;
    if ((chamber === "council" && !latest) || (latest && failedPolls))
      opening = await db
        .collection<RussianDumaRepeatOpeningRecord | RussianCouncilOpeningRecord>(
          chamber === "duma"
            ? RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION
            : RUSSIAN_COUNCIL_OPENINGS_COLLECTION
        )
        .findOne(
          { _id: id },
          { projection: { cohortId: 1, generation: 1, openedOnTurn: 1, npcAdmission: 1 } }
        );
    const planned = planRussianAssemblyCampaign({
      turn,
      rootId: root.toHexString(),
      activeAssembly,
      originalTermEndTurn:
        chamber === "duma" ? seating?.dumaTermEndTurn : seating?.councilTermEndTurn,
      firstNpcAdmitted:
        chamber === "duma"
          ? (country.ruDumaNpcAdmissionCohortId?.equals(root) ?? false)
          : opening?.npcAdmission != null,
      latestResult: latest
        ? { generation: latest.generation ?? 0, resolvedOnTurn: latest.resolvedOnTurn, failedPolls }
        : undefined,
      nextOpening:
        latest && opening
          ? {
              generation: opening.generation!,
              openedOnTurn: opening.openedOnTurn,
              npcAdmitted: opening.npcAdmission != null,
            }
          : undefined,
    });
    if (planned.admitFirst) {
      const admitted =
        chamber === "duma"
          ? await admitRussianDumaNpcNominees({ db, cohortId: root, turn, now })
          : await admitRussianCouncilNpcNominees({ db, cohortId: root, turn, now });
      result.npcCandidatesCreated += admitted?.created ?? 0;
    }
    if (planned.openRepeatGeneration != null && latest) {
      const request = { db, rootCohortId: root, previousResultId: latest._id, turn, now };
      const opened =
        chamber === "duma"
          ? await openRussianDumaRepeat(request)
          : await openRussianCouncilRepeat(request);
      if (opened?.created) result.repeatsOpened++;
      if (opened) opening = opened.record;
    }
    if (
      (planned.openRepeatGeneration != null || planned.admitRepeatGeneration != null) &&
      opening
    ) {
      const admitted =
        chamber === "duma"
          ? await admitRussianDumaRepeatNpcNominees({
              db,
              rootCohortId: root,
              generation,
              turn,
              now,
            })
          : await admitRussianCouncilNpcNominees({ db, cohortId: opening.cohortId, turn, now });
      result.npcCandidatesCreated += admitted?.created ?? 0;
    }
  }
  return result;
}
