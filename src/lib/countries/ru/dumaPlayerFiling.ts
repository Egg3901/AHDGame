/**
 * Russian Duma filing validates the persisted cohort before granting national scope.
 * validateRussianDumaPlayerFiling loads the world and constitutional binding,
 * then applies the same portable residence and nomination rules as the ballot model.
 */
import type { Db } from "mongodb";
import type {
  Character,
  CountryGameState,
  Election,
  GameState,
  PoliticalParty,
} from "@/lib/db/types";
import {
  RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION,
  type RussianDumaRepeatOpeningRecord,
} from "./dumaRepeatOpening";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import { decideRussianDumaFiling } from "./rules/assemblyFiling";
export async function validateRussianDumaPlayerFiling(input: {
  db: Db;
  election: Election;
  character: Pick<
    Character,
    "_id" | "countryId" | "homeState" | "party" | "federationPendingResidenceId"
  >;
  turn: number;
  registrationOrder: number;
}) {
  const { db, election, character, turn, registrationOrder } = input;
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  const country = await db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFirstDumaElectionCohortId: 1,
      },
    }
  );
  const binding = election.russianDumaRound;
  let validatedCohortId = binding?.cohortId.toHexString() ?? "";
  let holdsConstituencyMandate = false;
  if (binding?.rootCohortId || (binding?.generation ?? 0) !== 0) {
    if (
      !binding?.rootCohortId ||
      !Number.isSafeInteger(binding.generation) ||
      binding.generation! < 1 ||
      !country?.ruFirstDumaElectionCohortId?.equals(binding.rootCohortId)
    )
      return { allowed: false as const, reason: "unbound-mandate" as const };
    const opening = await db
      .collection<RussianDumaRepeatOpeningRecord>(RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION)
      .findOne(
        { _id: `${binding.rootCohortId.toHexString()}:repeat:${binding.generation}` },
        {
          projection: {
            rootCohortId: 1,
            cohortId: 1,
            generation: 1,
            mandateSinceTurn: 1,
            previousResultId: 1,
            electionIds: 1,
            seatIds: 1,
          },
        }
      );
    if (
      !opening?.rootCohortId.equals(binding.rootCohortId) ||
      !opening.cohortId.equals(binding.cohortId) ||
      opening.generation !== binding.generation ||
      opening.mandateSinceTurn !== binding.mandateSinceTurn ||
      !opening.electionIds.some((id) => id.equals(election._id)) ||
      opening.seatIds[opening.electionIds.findIndex((id) => id.equals(election._id))] !==
        election.seatId
    )
      return { allowed: false as const, reason: "unbound-mandate" as const };
    const previous = await db
      .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
      .findOne(
        { _id: opening.previousResultId },
        {
          projection: {
            countryId: 1,
            preset: 1,
            cohortId: 1,
            rootCohortId: 1,
            generation: 1,
            mandateSinceTurn: 1,
            result: 1,
          },
        }
      );
    if (
      !previous ||
      previous.countryId !== "RU" ||
      previous.preset !== "1991-default" ||
      !(previous.rootCohortId ?? previous.cohortId).equals(binding.rootCohortId) ||
      (previous.generation ?? 0) !== binding.generation! - 1 ||
      previous.mandateSinceTurn !== binding.mandateSinceTurn
    )
      return { allowed: false as const, reason: "unbound-mandate" as const };
    holdsConstituencyMandate = previous.result.constituencyResults.some(
      (row) => row.winner && !row.winner.isNpc && row.winner.ownerId === character._id.toHexString()
    );
    validatedCohortId = binding.rootCohortId.toHexString();
  }
  const partySequence = Number(character.party);
  const party =
    binding?.tier === "list" &&
    Number.isSafeInteger(partySequence) &&
    partySequence > 0 &&
    String(partySequence) === character.party
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .findOne(
            { countryId: "RU", sequentialId: partySequence, regimeStatus: { $ne: "banned" } },
            { projection: { countryId: 1, sequentialId: 1, regimeStatus: 1 } }
          )
      : null;
  return decideRussianDumaFiling({
    preset: game?.preset ?? "",
    turn,
    registrationOrder,
    successionSinceTurn: country?.ruSovietSuccessionSinceTurn,
    mandateSinceTurn: country?.ruFederalAssemblyMandateSinceTurn,
    boundCohortId: country?.ruFirstDumaElectionCohortId?.toHexString(),
    election: {
      countryId: election.countryId ?? "",
      type: election.electionType,
      state: election.state ?? "",
      seatId: election.seatId ?? "",
      totalSeats: election.totalSeats ?? 0,
      primaryEndTurn: election.primaryEndTurn,
      cohortId: validatedCohortId,
      mandateSinceTurn: binding?.mandateSinceTurn ?? 0,
      tier: binding?.tier ?? "constituency",
    },
    character: {
      countryId: character.countryId ?? "",
      homeState: character.homeState,
      party: character.party ?? "independent",
      pendingRelocation: character.federationPendingResidenceId !== undefined,
      holdsConstituencyMandate,
      recognizedParty:
        !!party &&
        party.countryId === "RU" &&
        party.sequentialId === partySequence &&
        party.regimeStatus !== "banned",
    },
  });
}
