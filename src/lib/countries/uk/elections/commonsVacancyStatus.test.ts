/**
 * The vacancy read model tells players what happens next for an open seat
 * using the same gate the watcher spawns on, so the panel cannot promise a
 * by-election the watcher will not run (#1379).
 */
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createFakeCommonsDb } from "@/lib/uk/elections/commonsTestDb";
import { loadCommonsVacancyStatus } from "./commonsVacancyStatus";
import { COMMONS_BY_ELECTION_TOTAL_TURNS } from "@/lib/turn/commonsByElections";

const TURN = 1302;

function seedWorld(elections: Record<string, unknown>[]) {
  const fake = createFakeCommonsDb();
  fake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
  fake.seed("ukCommonsVacancies", [
    {
      _id: new ObjectId(),
      countryId: "UK",
      state: "EAE",
      seats: 12,
      reason: "removal",
      status: "open",
      vacatedTurn: 1261,
    },
  ]);
  fake.seed("elections", elections);
  return fake;
}

function general(endTurn: number) {
  return {
    _id: new ObjectId(),
    countryId: "UK",
    state: "EAE",
    electionType: "commons",
    status: "active",
    endTurn,
  };
}

describe("loadCommonsVacancyStatus by-election gate", () => {
  it("reports a by-election next turn while the general is far off", async () => {
    const fake = seedWorld([general(1467)]);
    const status = await loadCommonsVacancyStatus(fake.db);
    expect(status.vacancies[0].byElection).toEqual({ kind: "spawn" });
  });

  it("reports the general that fills the seat when it closes first", async () => {
    const endTurn = TURN + COMMONS_BY_ELECTION_TOTAL_TURNS - 1;
    const fake = seedWorld([general(endTurn)]);
    const status = await loadCommonsVacancyStatus(fake.db);
    expect(status.vacancies[0].byElection).toEqual({ kind: "general_fills", endTurn });
  });

  it("reports the retry turn during the cooldown after a finished by-election", async () => {
    const fake = seedWorld([
      general(1467),
      {
        _id: new ObjectId(),
        countryId: "UK",
        state: "EAE",
        electionType: "special_commons",
        status: "resolved",
        endTurn: TURN - 5,
      },
    ]);
    const status = await loadCommonsVacancyStatus(fake.db);
    expect(status.vacancies[0].byElection).toMatchObject({ kind: "cooldown" });
  });
});
