import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import type {
  Crisis,
  CrisisLeaderResponse,
  GlobalResponseOutcome,
  CrisisTradeSanction,
} from "@/lib/db/types/crisis";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import { buildTradeAffinity } from "@/lib/trade/tradeAffinity";
import { liftEmbargo } from "@/lib/trade/commands/embargoCommands";
import { planCrisisSanctions } from "./rules";
import { applyCrisisTradeSanctions } from "./apply";

const sanction: CrisisTradeSanction = {
  participationAxis: "sanctions",
  targetRole: "belligerent",
  commodity: "ordnance",
  durationTurns: 48,
};
const roles = { DE: "bloc", FR: "bloc", YU: "belligerent" } as const;
const eligible = new Set(["DE", "FR", "YU"]);
const actorId = new ObjectId().toString();

describe("crisis trade sanctions", () => {
  it("requires an actual affirmative participant and excludes self-targets", () => {
    const plans = planCrisisSanctions(
      sanction,
      roles,
      [
        { countryId: "DE", actorId, responseScores: { sanctions: 4 } },
        { countryId: "FR", actorId, responseScores: { mediation: 4 } },
        { countryId: "YU", actorId, responseScores: { sanctions: 4 } },
        { countryId: "US", actorId, responseScores: { sanctions: 4 } },
      ],
      eligible,
      100
    );
    expect(plans).toEqual([
      {
        sourceCountry: "DE",
        targetCountry: "YU",
        createdBy: actorId,
        commodity: "ordnance",
        createdTurn: 100,
        expiresTurn: 148,
      },
    ]);
  });

  it("does not turn missing votes, invalid scores or narrative labels into restrictions", () => {
    expect(planCrisisSanctions(sanction, roles, [], eligible, 100)).toEqual([]);
    expect(
      planCrisisSanctions(
        sanction,
        roles,
        [{ countryId: "DE", actorId, responseScores: { sanctions: NaN } }],
        eligible,
        100
      )
    ).toEqual([]);
    expect(() =>
      planCrisisSanctions({ ...sanction, durationTurns: 0 }, roles, [], eligible, 100)
    ).toThrow();
  });

  it("materializes an enforced, expiring arms restriction without blocking relief or nonparticipants", async () => {
    const rows = new Map<string, TradeEmbargo>();
    const db = {
      collection: () => ({
        updateOne: async (
          { _id }: { _id: ObjectId },
          update: { $setOnInsert?: TradeEmbargo; $set?: Partial<TradeEmbargo> }
        ) => {
          const key = _id.toString();
          if (!rows.has(key) && update.$setOnInsert) rows.set(key, update.$setOnInsert);
          if (rows.has(key) && update.$set) Object.assign(rows.get(key)!, update.$set);
        },
        findOne: async ({ _id }: { _id: ObjectId }) => rows.get(_id.toString()) ?? null,
      }),
    } as unknown as Db;
    const outcome: GlobalResponseOutcome = {
      outcomeId: "pressure",
      label: "Pressure",
      description: "Arms sanctions",
      priority: 1,
      conditions: [],
      wireMessage: "Arms sanctions",
      tradeSanction: sanction,
    };
    const crisis: Pick<
      Crisis,
      "_id" | "globalResponse" | "startTurn" | "endTurn" | "durationTurns"
    > = {
      _id: new ObjectId(),
      startTurn: 90,
      endTurn: null,
      durationTurns: 10,
      globalResponse: {
        conflictKey: "yugoslavia",
        eventKey: "pressure",
        roleByCountry: roles,
        defaultOptionIdByRole: {},
        outcomes: [outcome],
        defaultOutcomeId: "pressure",
      },
    };
    const response: CrisisLeaderResponse = {
      countryId: "DE",
      characterId: new ObjectId(actorId),
      characterName: "Test leader",
      nodeId: "choice",
      optionId: "sanctions",
      optionLabel: "Sanctions",
      responseScores: { sanctions: 4 },
      respondedAt: new Date(),
    };
    const interaction = { leaderResponses: [response] };
    await applyCrisisTradeSanctions(db, crisis, interaction, outcome);
    await applyCrisisTradeSanctions(db, crisis, interaction, outcome);
    expect(rows.size).toBe(1);
    const embargo = [...rows.values()][0];
    expect(embargo.sourceCrisisId).toEqual(crisis._id);
    expect(embargo.expiresTurn).toBe(148);
    const affinity = (turn: number) =>
      buildTradeAffinity({
        ftaPairs: new Set(),
        blocsByCountry: new Map(),
        tariffs: [],
        embargoes: [...rows.values()].filter(
          (row) => row.expiresTurn == null || row.expiresTurn >= turn
        ),
      });
    expect(affinity(100).affinityFor("ordnance", "DE", "YU")).toBe(0);
    expect(affinity(100).affinityFor("ordnance", "YU", "DE")).toBe(0);
    expect(affinity(100).affinityFor("food", "DE", "YU")).toBeGreaterThan(0);
    expect(affinity(100).affinityFor("ordnance", "FR", "YU")).toBeGreaterThan(0);
    expect(affinity(149).affinityFor("ordnance", "DE", "YU")).toBeGreaterThan(0);
    expect((await liftEmbargo(db, embargo._id, "FR")).ok).toBe(false);
    expect((await liftEmbargo(db, embargo._id, "DE")).ok).toBe(true);
    await applyCrisisTradeSanctions(db, crisis, interaction, outcome);
    expect(rows.size).toBe(1);
    expect(affinity(100).affinityFor("ordnance", "DE", "YU")).toBeGreaterThan(0);
  });
});
