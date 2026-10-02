/**
 * Council reform enters through ordinary voted laws and a separate regional handover.
 * processRussianCouncilComposition authorizes signed proposals, settles bounded
 * regional decisions and installs the viable chamber inside required transactions.
 */
import type { Db } from "mongodb";
import { calendarTurn } from "@/lib/utils/gameDate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import type { RussianConstitutionalCalendar } from "./constitutionalProposals";
import {
  authorizeRussianCouncilFormation,
  RUSSIAN_COUNCIL_FORMATION_PROPOSALS_COLLECTION,
  type RussianCouncilFormationProposal,
} from "./councilFormationProposals";
import { materializeRussianRegionalAuthorities } from "./regionalCouncilAuthorities";
import { materializeRussianCouncilCompositionSeating } from "./councilCompositionSeating";
import type { CountryGameState } from "@/lib/db/types";

export async function processRussianCouncilComposition(input: {
  db: Db;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
}) {
  const { db, game, turn, now } = input;
  const result = { authorized: 0, authoritiesChanged: 0, seated: false };
  if (
    game.preset !== "1991-default" ||
    calendarTurn(turn, {
      preIterationActive: game.preIteration?.active,
      preIterationTurns: game.preIterationTurns,
    }) < 237
  )
    return result;
  const proposals = await db
    .collection<RussianCouncilFormationProposal>(RUSSIAN_COUNCIL_FORMATION_PROPOSALS_COLLECTION)
    .find({ countryId: "RU", preset: "1991-default", status: "open" }, { projection: { _id: 1 } })
    .limit(2)
    .toArray();
  for (const proposal of proposals)
    if (
      await runRequiredTransaction(
        (session) =>
          authorizeRussianCouncilFormation({ ...input, session, proposalId: proposal._id }),
        { client: db.client }
      )
    )
      result.authorized++;
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "RU" }, { projection: { ruCouncilFormationMandate: 1 } });
  if (!country?.ruCouncilFormationMandate) return result;
  const settlement = await runRequiredTransaction(
    async (session) => {
      const authorities = await materializeRussianRegionalAuthorities({ db, session, turn, now });
      const seated = await materializeRussianCouncilCompositionSeating({
        db,
        session,
        turn,
        now,
        ...("seatingInputs" in authorities ? { seatingInputs: authorities.seatingInputs } : {}),
      });
      return {
        authoritiesChanged: authorities.kind === "settled" ? authorities.changed : 0,
        seated,
      };
    },
    { client: db.client }
  );
  return { ...result, ...settlement };
}
