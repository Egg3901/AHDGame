/**
 * Duma campaigns use receipt-backed current authority without changing first roots.
 * loadRussianDumaAuthority validates ordinary openings against the current predecessor;
 * loadCurrentRussianDumaClock preserves the immutable first Assembly term proof.
 */
import { loadEnactedRussianDumaLaw } from "./dumaElectoralProposals1995";
import { russianDumaElectoralLaw, type RussianDumaElectoralLaw } from "./rules/dumaElectoralLaw";
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { CountryGameState } from "@/lib/db/types";
import type { RussianAssemblySeatingRecord } from "./assemblySeating";
import { planRussianDumaBallot } from "./rules/assemblySchedule";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
import {
  russianDumaConvocationTermEnd,
  validateRussianDumaConvocationClock,
} from "./rules/dumaConvocation";

export const RUSSIAN_DUMA_CONVOCATIONS_COLLECTION = "russianDumaConvocations";
export interface RussianDumaConvocationRecord {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  cohortId: ObjectId;
  firstDumaRoot: ObjectId;
  firstCouncilRoot: ObjectId;
  mandateSinceTurn: number;
  number: number;
  electoralLaw?: RussianDumaElectoralLaw;
  electoralMandate?: CountryGameState["ruDumaElectoralMandate"];
  predecessorCohortId: ObjectId;
  predecessorSeatedOnTurn: number;
  predecessorTermEndTurn: number;
  openedOnTurn: number;
  originalPollEndTurn: number;
  termEndTurn: number;
  electionIds: ObjectId[];
  createdAt: Date;
  seatedOnTurn?: number;
  resultId?: string;
  revision?: number;
  officialIds?: ObjectId[];
  dumaSeats?: number;
}
type AuthorityCountry = Pick<
  CountryGameState,
  | "ruFirstDumaElectionCohortId"
  | "ruFirstCouncilElectionCohortId"
  | "ruFederalAssemblySinceTurn"
  | "ruFederalAssemblyMandateSinceTurn"
  | "ruSovietSuccessionSinceTurn"
  | "ruDumaConvocationCohortId"
  | "ruDumaCurrentConvocationCohortId"
>;
export const RUSSIAN_DUMA_AUTHORITY_PROJECTION = {
  ruFirstDumaElectionCohortId: 1,
  ruFirstCouncilElectionCohortId: 1,
  ruFederalAssemblySinceTurn: 1,
  ruFederalAssemblyMandateSinceTurn: 1,
  ruSovietSuccessionSinceTurn: 1,
  ruDumaConvocationCohortId: 1,
  ruDumaCurrentConvocationCohortId: 1,
} as const;
export function russianDumaBoundRoot(country: AuthorityCountry) {
  return country.ruDumaConvocationCohortId ?? country.ruFirstDumaElectionCohortId;
}
export function russianDumaRootFilter(country: AuthorityCountry, root: ObjectId) {
  return country.ruDumaConvocationCohortId
    ? { ruDumaConvocationCohortId: root }
    : { ruFirstDumaElectionCohortId: root, ruDumaConvocationCohortId: { $exists: false } };
}
function validateRecord(
  record: RussianDumaConvocationRecord,
  country: AuthorityCountry,
  turn: number
) {
  const law = russianDumaElectoralLaw(record.electoralLaw);
  if (
    (law === "law1995") !== (record.electoralMandate != null) ||
    (record.electoralMandate &&
      (record.electoralMandate.law !== law ||
        record.electoralMandate.sinceTurn > record.openedOnTurn))
  )
    throw new Error("Duma opening lacks its frozen enacted law binding");
  if (
    record._id !== record.cohortId.toHexString() ||
    record.countryId !== "RU" ||
    record.preset !== "1991-default" ||
    !record.firstDumaRoot.equals(country.ruFirstDumaElectionCohortId!) ||
    !record.firstCouncilRoot.equals(country.ruFirstCouncilElectionCohortId!) ||
    record.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
    !Number.isSafeInteger(record.number) ||
    record.number < 2 ||
    !Number.isSafeInteger(record.openedOnTurn) ||
    record.openedOnTurn < record.mandateSinceTurn ||
    record.openedOnTurn > turn ||
    record.originalPollEndTurn !== planRussianDumaBallot(record.openedOnTurn).endTurn ||
    record.termEndTurn !==
      russianDumaConvocationTermEnd(record.originalPollEndTurn, record.number) ||
    record.electionIds.length !== 226 ||
    new Set(record.electionIds.map((id) => id.toHexString())).size !== 226 ||
    record.predecessorCohortId.equals(record.cohortId)
  )
    throw new Error("Ordinary Duma authority needs its complete immutable opening");
  validateRussianDumaConvocationClock({
    number: record.number - 1,
    rootId: record.predecessorCohortId.toHexString(),
    seatedOnTurn: record.predecessorSeatedOnTurn,
    termEndTurn: record.predecessorTermEndTurn,
  });
  if (
    record.openedOnTurn <
      record.predecessorTermEndTurn - planRussianDumaBallot(record.openedOnTurn).durationHours ||
    record.openedOnTurn < record.predecessorSeatedOnTurn
  )
    throw new Error("Ordinary Duma opening precedes its predecessor campaign window");
}
export async function loadCurrentRussianDumaClock(input: {
  db: Db;
  country: AuthorityCountry;
  turn: number;
  session?: ClientSession;
}) {
  const { db, country, turn, session } = input;
  if (
    !country.ruFirstDumaElectionCohortId ||
    !country.ruFirstCouncilElectionCohortId ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    ) ||
    country.ruFederalAssemblySinceTurn == null
  )
    return null;
  const current = country.ruDumaCurrentConvocationCohortId;
  if (current) {
    const row = await db
      .collection<RussianDumaConvocationRecord>(RUSSIAN_DUMA_CONVOCATIONS_COLLECTION)
      .findOne({ _id: current.toHexString() }, { session });
    if (!row) throw new Error("Current Duma lacks its seating journal");
    validateRecord(row, country, turn);
    if (
      !row.cohortId.equals(current) ||
      !Number.isSafeInteger(row.seatedOnTurn) ||
      row.seatedOnTurn! < row.originalPollEndTurn ||
      row.seatedOnTurn! > turn ||
      !row.resultId
    )
      throw new Error("Current Duma has no actual certified seating");
    const seating = await db
      .collection<RussianAssemblySeatingRecord>("russianAssemblySeatings")
      .findOne(
        { _id: `${current.toHexString()}:duma` },
        {
          session,
          projection: {
            countryId: 1,
            preset: 1,
            dumaRootCohortId: 1,
            seatedOnTurn: 1,
            dumaTermEndTurn: 1,
          },
        }
      );
    if (
      !seating ||
      seating.countryId !== "RU" ||
      seating.preset !== "1991-default" ||
      !seating.dumaRootCohortId.equals(current) ||
      seating.seatedOnTurn !== row.seatedOnTurn ||
      seating.dumaTermEndTurn !== row.termEndTurn
    )
      throw new Error("Current Duma requires its actual immutable handover receipt");
    return validateRussianDumaConvocationClock({
      number: row.number,
      rootId: row._id,
      seatedOnTurn: row.seatedOnTurn!,
      termEndTurn: row.termEndTurn,
    });
  }
  const first = await db
    .collection<RussianAssemblySeatingRecord>("russianAssemblySeatings")
    .findOne(
      {
        _id: `${country.ruFirstDumaElectionCohortId.toHexString()}:${country.ruFirstCouncilElectionCohortId.toHexString()}`,
      },
      {
        session,
        projection: {
          countryId: 1,
          preset: 1,
          dumaRootCohortId: 1,
          councilRootCohortId: 1,
          seatedOnTurn: 1,
          dumaTermEndTurn: 1,
        },
      }
    );
  if (
    !first ||
    first.countryId !== "RU" ||
    first.preset !== "1991-default" ||
    !first.dumaRootCohortId.equals(country.ruFirstDumaElectionCohortId) ||
    !first.councilRootCohortId.equals(country.ruFirstCouncilElectionCohortId) ||
    first.seatedOnTurn !== country.ruFederalAssemblySinceTurn
  )
    throw new Error("Duma recurrence requires the actual first Assembly seating");
  return validateRussianDumaConvocationClock({
    number: 1,
    rootId: first.dumaRootCohortId.toHexString(),
    seatedOnTurn: first.seatedOnTurn,
    termEndTurn: first.dumaTermEndTurn,
  });
}
export async function loadRussianDumaAuthority(input: {
  db: Db;
  country: AuthorityCountry;
  root: ObjectId;
  turn: number;
  session?: ClientSession;
}) {
  const { db, country, root, turn, session } = input;
  if (
    !russianDumaBoundRoot(country)?.equals(root) ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return null;
  if (!country.ruDumaConvocationCohortId) return { number: 1, record: null };
  if (!country.ruFirstDumaElectionCohortId || !country.ruFirstCouncilElectionCohortId)
    throw new Error("Ordinary Duma cannot replace missing first Assembly roots");
  const record = await db
    .collection<RussianDumaConvocationRecord>(RUSSIAN_DUMA_CONVOCATIONS_COLLECTION)
    .findOne({ _id: root.toHexString() }, { session });
  if (!record) throw new Error("Ordinary Duma campaign lacks its immutable journal");
  validateRecord(record, country, turn);
  if (record.electoralMandate) {
    await loadEnactedRussianDumaLaw({
      db,
      session,
      country: { ...country, ruDumaElectoralMandate: record.electoralMandate },
      turn: record.openedOnTurn,
    });
  }
  const current = await loadCurrentRussianDumaClock(input);
  if (
    !current ||
    (record.seatedOnTurn != null
      ? current.rootId !== root.toHexString() ||
        current.number !== record.number ||
        current.seatedOnTurn !== record.seatedOnTurn
      : current.rootId !== record.predecessorCohortId.toHexString() ||
        current.number + 1 !== record.number ||
        current.seatedOnTurn !== record.predecessorSeatedOnTurn ||
        current.termEndTurn !== record.predecessorTermEndTurn)
  )
    throw new Error("Ordinary Duma campaign does not match the actual current predecessor");
  return { number: record.number, record };
}
