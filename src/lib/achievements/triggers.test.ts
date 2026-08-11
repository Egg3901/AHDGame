import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const awardAchievements = vi.fn().mockResolvedValue(0);

vi.mock("./index", () => ({
  awardAchievement: vi.fn(),
  awardAchievements,
}));

describe("checkPassiveProfileAchievements", () => {
  beforeEach(() => {
    awardAchievements.mockClear();
  });

  it("awards matching profile and combined-role achievements in one batch", async () => {
    const { checkPassiveProfileAchievements } = await import("./triggers");
    const userId = new ObjectId();
    const characterId = new ObjectId();

    await checkPassiveProfileAchievements(userId, characterId, {
      iteration: { type: "Iteration", number: 1 },
      hasCeoCorp: true,
      hasCabinetSeat: true,
      hasCentralBankChair: false,
      isPartyChair: true,
      hasElectedOffice: true,
      bondIncomePerTurn: 10,
      dividendIncomePerTurn: 0,
      characterCreatedAt: new Date(),
      statsAllocated: false,
      onboardingComplete: true,
      hallOfFameTop10: false,
    });

    expect(awardAchievements).toHaveBeenCalledWith(
      userId,
      [
        "iteration4_founder",
        "corner_office",
        "cabinet_seat",
        "bondholder",
        "onboarded",
        "iron_triangle",
      ],
      characterId
    );
  });
});
