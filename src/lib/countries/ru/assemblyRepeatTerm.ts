/**
 * Assembly repeats bind to their actual initial seating and original chamber term.
 * loadRussianAssemblyRepeatTerm reads the immutable handover journal and proves
 * an already seated predecessor without extending its constitutional election clock.
 */
import type { ClientSession, Db } from "mongodb";
import type { CountryGameState } from "@/lib/db/types";
import {
  RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION,
  type RussianAssemblySeatingRecord,
} from "./assemblySeating";
import { loadRussianDumaAuthority, russianDumaBoundRoot } from "./dumaConvocationAuthority";
import { validateRussianAssemblyRepeatTerm } from "./rules/assemblyTermBinding";
export async function loadRussianAssemblyRepeatTerm(input: {
  db: Db;
  session?: ClientSession;
  country: Pick<
    CountryGameState,
    | "ruFederalAssemblySinceTurn"
    | "ruFirstDumaElectionCohortId"
    | "ruFirstCouncilElectionCohortId"
    | "ruFederalAssemblyMandateSinceTurn"
    | "ruSovietSuccessionSinceTurn"
    | "ruDumaConvocationCohortId"
    | "ruDumaCurrentConvocationCohortId"
  >;
  chamber: "duma" | "council";
  turn: number;
  electionEndTurn?: number;
  previous?: { _id: string; seatedOnTurn?: number };
}) {
  const { db, session, country, previous } = input;
  if (input.chamber === "duma" && country.ruDumaConvocationCohortId) {
    const authority = await loadRussianDumaAuthority({
      db,
      session,
      country,
      root: russianDumaBoundRoot(country)!,
      turn: input.turn,
    });
    if (!authority?.record) throw new Error("Ordinary Duma repeat lacks its convocation authority");
    const record = authority.record;
    if (
      input.turn >= record.termEndTurn ||
      (input.electionEndTurn != null &&
        (!Number.isSafeInteger(input.electionEndTurn) ||
          input.electionEndTurn < input.turn ||
          input.electionEndTurn >= record.termEndTurn))
    )
      throw new Error("Duma repeat exceeds its original convocation term");
    if (
      previous?.seatedOnTurn != null &&
      !(await db
        .collection<RussianAssemblySeatingRecord>(RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION)
        .findOne(
          {
            countryId: "RU",
            preset: "1991-default",
            dumaRootCohortId: record.cohortId,
            dumaResultId: previous._id,
            seatedOnTurn: previous.seatedOnTurn,
          },
          { session, projection: { _id: 1 } }
        ))
    )
      throw new Error("Duma predecessor seating needs its actual receipt");
    return {
      stage: record.seatedOnTurn == null ? ("pending" as const) : ("seated" as const),
      termEndTurn: record.termEndTurn,
    };
  }
  const dumaRootId = country.ruFirstDumaElectionCohortId?.toHexString();
  const councilRootId = country.ruFirstCouncilElectionCohortId?.toHexString();
  const seated = country.ruFederalAssemblySinceTurn != null;
  const journals = db.collection<RussianAssemblySeatingRecord>(
    RUSSIAN_ASSEMBLY_SEATINGS_COLLECTION
  );
  const root =
    seated && dumaRootId && councilRootId
      ? await journals.findOne(
          { _id: `${dumaRootId}:${councilRootId}` },
          {
            session,
            projection: {
              preset: 1,
              countryId: 1,
              dumaRootCohortId: 1,
              councilRootCohortId: 1,
              seatedOnTurn: 1,
              dumaTermEndTurn: 1,
              councilTermEndTurn: 1,
            },
          }
        )
      : null;
  const previousSeating =
    seated && previous?.seatedOnTurn != null
      ? await journals.findOne(
          {
            countryId: "RU",
            preset: "1991-default",
            dumaRootCohortId: country.ruFirstDumaElectionCohortId,
            councilRootCohortId: country.ruFirstCouncilElectionCohortId,
            seatedOnTurn: previous.seatedOnTurn,
            [input.chamber === "duma" ? "dumaResultId" : "councilResultId"]: previous._id,
          },
          { session, projection: { _id: 1 } }
        )
      : null;
  return validateRussianAssemblyRepeatTerm({
    turn: input.turn,
    electionEndTurn: input.electionEndTurn,
    chamber: input.chamber,
    assemblySinceTurn: country.ruFederalAssemblySinceTurn,
    dumaRootId,
    councilRootId,
    previousSeatedOnTurn: previous?.seatedOnTurn,
    previousSeatingProven: !!previousSeating,
    proof: root
      ? {
          id: root._id,
          preset: root.preset,
          countryId: root.countryId,
          dumaRootId: root.dumaRootCohortId.toHexString(),
          councilRootId: root.councilRootCohortId.toHexString(),
          seatedOnTurn: root.seatedOnTurn,
          dumaTermEndTurn: root.dumaTermEndTurn,
          councilTermEndTurn: root.councilTermEndTurn,
        }
      : undefined,
  });
}
