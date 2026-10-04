import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Election } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { loadPendingRussianCouncilOwners } from "./pendingCouncilMandates";
import { validateRussianDumaPlayerFiling } from "./dumaPlayerFiling";
import { RUSSIAN_COUNCIL_RESULTS_COLLECTION } from "./councilElectionResult";
function scenario() {
  const mem = createInMemoryDb();
  const councilId = new ObjectId();
  const dumaId = new ObjectId();
  const playerId = new ObjectId();
  mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  mem.seed("countryGameStates", [
    {
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
      ruFirstDumaElectionCohortId: dumaId,
      ruFirstCouncilElectionCohortId: councilId,
    },
  ]);
  mem.seed("politicalParties", [{ _id: new ObjectId(), countryId: "RU", sequentialId: 1 }]);
  mem.seed(RUSSIAN_COUNCIL_RESULTS_COLLECTION, [
    {
      _id: councilId.toHexString(),
      cohortId: councilId,
      countryId: "RU",
      preset: "1991-default",
      mandateSinceTurn: 129,
      result: [{ winners: [{ ownerId: playerId.toHexString(), isNpc: false }] }],
    },
  ]);
  const election = {
    _id: new ObjectId(),
    countryId: "RU",
    electionType: "dumaDeputy",
    state: "RU",
    seatId: "RU-duma-national-list",
    totalSeats: 225,
    primaryEndTurn: 139,
    russianDumaRound: {
      cohortId: dumaId,
      mandateSinceTurn: 129,
      tier: "list",
      registeredVoters: 1000,
    },
  } as Election;
  const character = {
    _id: playerId,
    countryId: "RU" as const,
    homeState: "CEN",
    party: "1",
    currentOffice: null,
  };
  return {
    mem,
    playerId,
    councilId,
    input: { db: mem as unknown as Db, election, character, turn: 130, registrationOrder: 1000 },
  };
}
describe("Reserved Council mandates protect Duma compatibility", () => {
  it.each(["list", "constituency"])(
    "blocks an unseated Council winner from a Duma %s ballot",
    async (tier) => {
      const { input } = scenario();
      if (tier === "constituency")
        Object.assign(input.election, {
          state: "CEN",
          seatId: "RU-duma-CEN-1",
          totalSeats: 1,
          russianDumaRound: { ...input.election.russianDumaRound, tier },
        });
      expect(await validateRussianDumaPlayerFiling(input)).toEqual({
        allowed: false,
        reason: "council-mandate",
      });
    }
  );
  it.each(["other-owner", "npc-owner", "seated", "foreign", "wrong-mandate", "wrong-cohort"])(
    "does not reserve a player's mandate from %s receipt",
    async (defect) => {
      const { mem, input } = scenario();
      const receipt = mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0];
      const winners = (
        receipt.result as Array<{ winners: Array<{ ownerId: string; isNpc: boolean }> }>
      )[0].winners;
      if (defect === "other-owner") winners[0].ownerId = new ObjectId().toHexString();
      if (defect === "npc-owner") winners[0].isNpc = true;
      if (defect === "seated") receipt.seatedOnTurn = 142;
      if (defect === "foreign") receipt.countryId = "CZ";
      if (defect === "wrong-mandate") receipt.mandateSinceTurn = 130;
      if (defect === "wrong-cohort") receipt.cohortId = new ObjectId();
      expect(await validateRussianDumaPlayerFiling(input)).toMatchObject({ allowed: true });
    }
  );
  it("reads both NPC and player reserved owners distinctly", async () => {
    const { mem, input, councilId, playerId } = scenario();
    const receipt = mem.collection(RUSSIAN_COUNCIL_RESULTS_COLLECTION).docs[0];
    receipt.result = [
      {
        winners: [
          { ownerId: playerId.toHexString(), isNpc: false },
          { ownerId: playerId.toHexString(), isNpc: true },
        ],
      },
    ];
    expect(
      await loadPendingRussianCouncilOwners({
        db: input.db,
        cohortId: councilId,
        mandateSinceTurn: 129,
      })
    ).toEqual(new Set([`player:${playerId.toHexString()}`, `npc:${playerId.toHexString()}`]));
  });
});
