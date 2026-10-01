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
import { decideRussianDumaFiling } from "./rules/assemblyFiling";
export async function validateRussianDumaPlayerFiling(input: {
  db: Db;
  election: Election;
  character: Pick<Character, "countryId" | "homeState" | "party" | "federationPendingResidenceId">;
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
      cohortId: binding?.cohortId.toHexString() ?? "",
      mandateSinceTurn: binding?.mandateSinceTurn ?? 0,
      tier: binding?.tier ?? "constituency",
    },
    character: {
      countryId: character.countryId ?? "",
      homeState: character.homeState,
      party: character.party ?? "independent",
      pendingRelocation: character.federationPendingResidenceId !== undefined,
      recognizedParty:
        !!party &&
        party.countryId === "RU" &&
        party.sequentialId === partySequence &&
        party.regimeStatus !== "banned",
    },
  });
}
