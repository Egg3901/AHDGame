import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const capture = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/analytics/intakeEvents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/intakeEvents")>()),
  captureIntakeEvent: capture,
}));

import {
  joinedBand,
  newlyCompletedSteps,
  recordOnboardingProgress,
  type StampableCharacter,
} from "./stepStamps";
import type { OnboardingSignals } from "./checklist";

const NONE: OnboardingSignals = {
  hasVoted: false,
  hasCandidacy: false,
  hasInvested: false,
  hasCampaignActed: false,
  hasCompany: false,
  hasUnion: false,
};
const NOW = new Date("2026-10-14T12:00:00Z");

function character(over: Partial<StampableCharacter> = {}): StampableCharacter {
  return {
    _id: new ObjectId(),
    countryId: "US",
    homeState: "CA",
    party: "independent",
    currentOffice: null,
    careerHistory: [],
    onboarding: { steps: { "scout-state": NOW } },
    createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
    createdTurn: 120,
    ...over,
  } as StampableCharacter;
}

describe("newlyCompletedSteps", () => {
  it("returns derived steps that are done and not yet stamped, never page-visit steps", () => {
    const c = character({ party: "3", onboarding: { steps: { "join-party": NOW } } });
    expect(newlyCompletedSteps(c, { ...NONE, hasInvested: true, hasCampaignActed: true })).toEqual([
      "invest",
      "campaign-action",
    ]);
  });
});

describe("joinedBand", () => {
  it("splits founding-race joiners from joiners of a running world", () => {
    expect(joinedBand(10)).toBe("founding");
    expect(joinedBand(48)).toBe("founding");
    expect(joinedBand(49)).toBe("mid_world");
    expect(joinedBand(undefined)).toBe("unknown");
  });
});

describe("recordOnboardingProgress", () => {
  let db: MockDb;
  beforeEach(() => {
    capture.mockClear();
    db = createMockDb();
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("stamps the first Campaign at its real time and counts it anonymously", async () => {
    const firstCampaign = new Date("2026-10-14T10:30:00Z");
    const actionLogs = db.collection("actionLogs");
    actionLogs.find.mockReturnValue({
      sort: () => ({ limit: () => ({ next: async () => ({ createdAt: firstCampaign }) }) }),
    });
    const c = character();
    const stamped = await recordOnboardingProgress(db as unknown as Db, c, {
      signals: { ...NONE, hasCampaignActed: true },
      now: NOW,
    });
    expect(stamped).toEqual(["campaign-action"]);
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledWith(
      { _id: c._id, "onboarding.steps.campaign-action": { $exists: false } },
      { $set: { "onboarding.steps.campaign-action": firstCampaign } }
    );
    expect(capture).toHaveBeenCalledWith("onboarding_step_done", {
      step: "campaign_action",
      joined: "mid_world",
      character_age_band: "under_1h",
    });
  });

  it("does not count a step another request stamped first", async () => {
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 0 });
    const stamped = await recordOnboardingProgress(db as unknown as Db, character({ party: "3" }), {
      signals: NONE,
      now: NOW,
    });
    expect(stamped).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it("ignores characters past the onboarding window", async () => {
    const old = character({ createdAt: new Date(NOW.getTime() - 40 * 86_400_000), party: "3" });
    expect(
      await recordOnboardingProgress(db as unknown as Db, old, { signals: NONE, now: NOW })
    ).toEqual([]);
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
  });

  it("never throws into the page", async () => {
    db.collection("characters").updateOne.mockRejectedValue(new Error("db down"));
    await expect(
      recordOnboardingProgress(db as unknown as Db, character({ party: "3" }), {
        signals: NONE,
        now: NOW,
      })
    ).resolves.toEqual([]);
  });
});
