import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

import { payContestPrize } from "./prize";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { emitTx } from "@/lib/financialTxLog/emit";
import { createNotification } from "@/lib/notifications";
import { placePrizeAnchor } from "./rules";

const character = {
  _id: new ObjectId(),
  userId: new ObjectId(),
  name: "Hiro",
  countryId: "JP" as const,
  sequentialId: 7,
};
const input = {
  character,
  round: { _id: "influence_gain:3", kind: "influence_gain" as const, roundNumber: 3 },
  subjectName: "Hiro",
  place: 1,
  turn: 120,
  preset: undefined,
  now: new Date("2026-10-09T00:00:00Z"),
};

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("characters").updateOne.mockResolvedValue({ matchedCount: 1 });
});

describe("payContestPrize", () => {
  it("credits personal cash in the home currency at the live rate and logs an attributed mint", async () => {
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    db.collection("exchangeRates").findOne.mockResolvedValue({ _id: "JP", rate: 150 });

    const result = await payContestPrize(db as unknown as Db, input);

    const anchor = placePrizeAnchor("influence_gain", 1, undefined);
    expect(result).toEqual({
      credited: true,
      anchorAmount: anchor,
      localAmount: anchor * 150,
      currencyCode: "JPY",
    });
    expect(db.collection("characters").updateOne).toHaveBeenCalledWith(
      { _id: character._id },
      expect.objectContaining({ $inc: { "currencyBalances.personal.JPY": anchor * 150 } })
    );
    expect(emitTx).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: "contest_prize",
        subjectId: character._id,
        amount: anchor * 150,
        currencyCode: "JPY",
        anchorAmount: anchor,
        meta: { roundId: "influence_gain:3", kind: "influence_gain", place: 1 },
      })
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: character.userId })
    );
  });

  it("pays a place its share and says where it finished", async () => {
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const result = await payContestPrize(db as unknown as Db, { ...input, place: 2 });

    expect(result.anchorAmount).toBe(placePrizeAnchor("influence_gain", 2, undefined));
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "You placed in a weekly contest",
        message: expect.stringContaining("finished second"),
      })
    );
  });

  it("logs nothing when the character is gone", async () => {
    vi.mocked(isForexEnabled).mockResolvedValue(false);
    db.collection("characters").updateOne.mockResolvedValue({ matchedCount: 0 });

    const result = await payContestPrize(db as unknown as Db, input);

    expect(result.credited).toBe(false);
    expect(emitTx).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });
});
