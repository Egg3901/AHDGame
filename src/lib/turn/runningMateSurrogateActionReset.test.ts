import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "@/lib/mongodb";
import { resetRunningMateSurrogateActions } from "./runningMateSurrogateActionReset";
import { getCalendarDayInTimezone } from "@/lib/time/dailyReset";

function projectCursor(docs: unknown[]) {
  return { project: () => ({ toArray: () => Promise.resolve(docs) }) };
}

describe("resetRunningMateSurrogateActions", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("refills each active presidential ticket's pool to the ruleset cap once per day", async () => {
    const electionId = new ObjectId();
    const nomineeId = new ObjectId();
    const campaignId = new ObjectId();

    db.collection("elections").find.mockReturnValue(
      projectCursor([{ _id: electionId, rulesetVersion: 3 }])
    );
    db.collection("electionCandidates").find.mockReturnValue(
      projectCursor([{ electionId, characterId: nomineeId }])
    );
    db.collection("campaigns").find.mockReturnValue(
      // Reset day absent → the daily boundary applies.
      projectCursor([
        { _id: campaignId, electionId, runningMateSurrogateActionsResetDay: undefined },
      ])
    );

    const result = await resetRunningMateSurrogateActions(db as unknown as Db);

    expect(result.surrogatePoolsReset).toBe(1);
    const bulkArg = db.collectionMocks.campaigns.bulkWrite.mock.calls[0][0];
    const op = bulkArg[0].updateOne;
    expect(op.filter._id).toBe(campaignId);
    // v3 vpSurrogateActionCap identity = 2.
    expect(op.update.$set.runningMateSurrogateActionsRemaining).toBe(2);
    expect(op.update.$set.runningMateSurrogateActionsResetDay).toBe(
      getCalendarDayInTimezone(new Date())
    );
  });

  it("skips tickets already refilled today", async () => {
    const electionId = new ObjectId();
    const nomineeId = new ObjectId();
    const today = getCalendarDayInTimezone(new Date());

    db.collection("elections").find.mockReturnValue(
      projectCursor([{ _id: electionId, rulesetVersion: 3 }])
    );
    db.collection("electionCandidates").find.mockReturnValue(
      projectCursor([{ electionId, characterId: nomineeId }])
    );
    db.collection("campaigns").find.mockReturnValue(
      projectCursor([
        { _id: new ObjectId(), electionId, runningMateSurrogateActionsResetDay: today },
      ])
    );

    const result = await resetRunningMateSurrogateActions(db as unknown as Db);

    expect(result.surrogatePoolsReset).toBe(0);
    expect(db.collectionMocks.campaigns.bulkWrite).not.toHaveBeenCalled();
  });

  it("no-ops when there are no active presidential elections", async () => {
    db.collection("elections").find.mockReturnValue(projectCursor([]));
    const result = await resetRunningMateSurrogateActions(db as unknown as Db);
    expect(result.surrogatePoolsReset).toBe(0);
  });

  it("no-ops when no ticket has a running mate", async () => {
    db.collection("elections").find.mockReturnValue(
      projectCursor([{ _id: new ObjectId(), rulesetVersion: 3 }])
    );
    db.collection("electionCandidates").find.mockReturnValue(projectCursor([]));
    const result = await resetRunningMateSurrogateActions(db as unknown as Db);
    expect(result.surrogatePoolsReset).toBe(0);
  });
});
