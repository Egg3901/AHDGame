import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { isOfficePoolAccrualTurn } from "@/lib/actions/officePoolAccrual";
import { VP_ACTION_ACCRUAL_TURNS, VP_ACTION_CAP } from "@/lib/constants/vicePresidentActions";
import { JUSTICE_ACTION_ACCRUAL_TURNS, JUSTICE_ACTION_CAP } from "@/lib/constants/justiceActions";
import { resetVicePresidentActions } from "./vicePresidentActionReset";
import { resetJusticeActions } from "./justiceActionReset";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

describe("isOfficePoolAccrualTurn", () => {
  it("fires only on positive multiples of the interval", () => {
    expect(isOfficePoolAccrualTurn(12, 12)).toBe(true);
    expect(isOfficePoolAccrualTurn(24, 12)).toBe(true);
    expect(isOfficePoolAccrualTurn(13, 12)).toBe(false);
    expect(isOfficePoolAccrualTurn(0, 12)).toBe(false);
    expect(isOfficePoolAccrualTurn(12, 0)).toBe(false);
  });

  it("keeps the same daily throughput as the old midnight refill (24 turns per day)", () => {
    expect(24 / VP_ACTION_ACCRUAL_TURNS).toBe(VP_ACTION_CAP);
    expect(24 / JUSTICE_ACTION_ACCRUAL_TURNS).toBe(JUSTICE_ACTION_CAP);
  });
});

describe("resetVicePresidentActions", () => {
  it("adds one action below cap on an accrual turn, gated on the turn stamp", async () => {
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials!.updateMany.mockResolvedValue({ modifiedCount: 1 });
    const turn = VP_ACTION_ACCRUAL_TURNS * 9;
    await expect(resetVicePresidentActions(db as unknown as Db, turn)).resolves.toEqual({
      vpActionsRegenerated: 1,
    });
    expect(db.collectionMocks.electedOfficials!.updateMany).toHaveBeenCalledWith(
      {
        officeType: "vicePresident",
        vpActionsRemaining: { $lt: VP_ACTION_CAP },
        lastVpActionAccrualTurn: { $ne: turn },
      },
      { $inc: { vpActionsRemaining: 1 }, $set: { lastVpActionAccrualTurn: turn } }
    );
  });

  it("does nothing between accrual turns", async () => {
    db.collection("electedOfficials");
    await expect(
      resetVicePresidentActions(db as unknown as Db, VP_ACTION_ACCRUAL_TURNS * 9 + 5)
    ).resolves.toEqual({ vpActionsRegenerated: 0 });
    expect(db.collectionMocks.electedOfficials!.updateMany).not.toHaveBeenCalled();
  });
});

describe("resetJusticeActions", () => {
  it("adds one action to occupied seats below cap on an accrual turn", async () => {
    db.collection("supremeCourtSeats");
    db.collectionMocks.supremeCourtSeats!.updateMany.mockResolvedValue({ modifiedCount: 3 });
    const turn = JUSTICE_ACTION_ACCRUAL_TURNS * 4;
    await expect(resetJusticeActions(db as unknown as Db, turn)).resolves.toEqual({
      justiceActionsRegenerated: 3,
    });
    expect(db.collectionMocks.supremeCourtSeats!.updateMany).toHaveBeenCalledWith(
      {
        justiceCharacterId: { $ne: null },
        justiceActionsRemaining: { $lt: JUSTICE_ACTION_CAP },
        lastJusticeActionAccrualTurn: { $ne: turn },
      },
      { $inc: { justiceActionsRemaining: 1 }, $set: { lastJusticeActionAccrualTurn: turn } }
    );
  });

  it("does nothing between accrual turns", async () => {
    db.collection("supremeCourtSeats");
    await expect(
      resetJusticeActions(db as unknown as Db, JUSTICE_ACTION_ACCRUAL_TURNS + 1)
    ).resolves.toEqual({ justiceActionsRegenerated: 0 });
    expect(db.collectionMocks.supremeCourtSeats!.updateMany).not.toHaveBeenCalled();
  });
});
