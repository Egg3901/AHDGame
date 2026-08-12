import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  ONBOARDING_STEP_IDS,
  TRACKED_ONBOARDING_STEP_IDS,
  buildOnboardingStepContent,
  deriveOnboardingChecklist,
  hasVotedOnAnyBill,
  isOnboardingDismissed,
  isOnboardingStepComplete,
  isTrackedOnboardingStepId,
  loadOnboardingSignals,
  type OnboardingCharacter,
  type OnboardingSignals,
} from "./checklist";

const NO_SIGNALS: OnboardingSignals = {
  hasVoted: false,
  hasCandidacy: false,
  hasInvested: false,
  hasCampaignActed: false,
  hasCompany: false,
  hasUnion: false,
};

const ALL_SIGNALS: OnboardingSignals = {
  hasVoted: true,
  hasCandidacy: true,
  hasInvested: true,
  hasCampaignActed: true,
  hasCompany: true,
  hasUnion: true,
};

const VISITED_BOTH_PAGES = {
  steps: { "scout-state": new Date(), "read-wire": new Date() },
};

function makeCharacter(overrides: Partial<OnboardingCharacter> = {}): OnboardingCharacter {
  return {
    _id: new ObjectId(),
    countryId: "US",
    homeState: "NY",
    party: "independent",
    currentOffice: null,
    careerHistory: [],
    ...overrides,
  } as OnboardingCharacter;
}

describe("buildOnboardingStepContent", () => {
  it("returns every step in canonical order", () => {
    const steps = buildOnboardingStepContent(makeCharacter());
    expect(steps.map((s) => s.id)).toEqual([...ONBOARDING_STEP_IDS]);
  });

  it("uses the country region noun and deep links to the home region", () => {
    const us = buildOnboardingStepContent(makeCharacter({ countryId: "US", homeState: "NY" }));
    expect(us[0].title).toBe("Scout your home state");
    expect(us[0].link).toBe("/country/us/region/NY");

    const uk = buildOnboardingStepContent(makeCharacter({ countryId: "UK", homeState: "LDN" }));
    expect(uk[0].title).toBe("Scout your home nation");
    expect(uk[0].link).toBe("/country/uk/region/LDN");
  });

  it("routes first-vote to the canonical legislature route, never the /congress redirect", () => {
    // /congress is a redirect shell to /country/{code}/legislature. Linking a
    // guided step at a redirect softlocks the coach, so no surface may use it.
    const us = buildOnboardingStepContent(makeCharacter({ countryId: "US" }));
    expect(us.find((s) => s.id === "first-vote")!.link).toBe("/country/us/legislature");

    const de = buildOnboardingStepContent(makeCharacter({ countryId: "DE", homeState: "BY" }));
    expect(de.find((s) => s.id === "first-vote")!.link).toBe("/country/de/legislature");
  });

  it("contains no em-dashes or en-dashes in any player-facing copy", () => {
    for (const countryId of ["US", "UK", "DE", "JP"] as const) {
      for (const step of buildOnboardingStepContent(makeCharacter({ countryId }))) {
        expect(step.title).not.toMatch(/[–—]/);
        expect(step.body).not.toMatch(/[–—]/);
      }
    }
  });
});

describe("isOnboardingStepComplete", () => {
  it("scout-state: false until the visit is recorded, true after", () => {
    expect(isOnboardingStepComplete("scout-state", makeCharacter(), NO_SIGNALS)).toBe(false);
    const visited = makeCharacter({ onboarding: { steps: { "scout-state": new Date() } } });
    expect(isOnboardingStepComplete("scout-state", visited, NO_SIGNALS)).toBe(true);
  });

  it("read-wire: false until the visit is recorded, true after", () => {
    expect(isOnboardingStepComplete("read-wire", makeCharacter(), NO_SIGNALS)).toBe(false);
    const visited = makeCharacter({ onboarding: { steps: { "read-wire": new Date() } } });
    expect(isOnboardingStepComplete("read-wire", visited, NO_SIGNALS)).toBe(true);
  });

  it("join-party: independent and empty party are incomplete, a real party completes", () => {
    expect(
      isOnboardingStepComplete("join-party", makeCharacter({ party: "independent" }), NO_SIGNALS)
    ).toBe(false);
    expect(isOnboardingStepComplete("join-party", makeCharacter({ party: "" }), NO_SIGNALS)).toBe(
      false
    );
    expect(isOnboardingStepComplete("join-party", makeCharacter({ party: "3" }), NO_SIGNALS)).toBe(
      true
    );
  });

  it("first-vote follows the hasVoted signal", () => {
    expect(isOnboardingStepComplete("first-vote", makeCharacter(), NO_SIGNALS)).toBe(false);
    expect(
      isOnboardingStepComplete("first-vote", makeCharacter(), { ...NO_SIGNALS, hasVoted: true })
    ).toBe(true);
  });

  it("invest follows the hasInvested signal", () => {
    expect(isOnboardingStepComplete("invest", makeCharacter(), NO_SIGNALS)).toBe(false);
    expect(
      isOnboardingStepComplete("invest", makeCharacter(), { ...NO_SIGNALS, hasInvested: true })
    ).toBe(true);
  });

  it("campaign-action follows the hasCampaignActed signal", () => {
    expect(isOnboardingStepComplete("campaign-action", makeCharacter(), NO_SIGNALS)).toBe(false);
    expect(
      isOnboardingStepComplete("campaign-action", makeCharacter(), {
        ...NO_SIGNALS,
        hasCampaignActed: true,
      })
    ).toBe(true);
  });

  it("file-for-race: candidacy, current office, or an office career event each complete it", () => {
    expect(isOnboardingStepComplete("file-for-race", makeCharacter(), NO_SIGNALS)).toBe(false);
    expect(
      isOnboardingStepComplete("file-for-race", makeCharacter(), {
        ...NO_SIGNALS,
        hasCandidacy: true,
      })
    ).toBe(true);
    expect(
      isOnboardingStepComplete(
        "file-for-race",
        makeCharacter({ currentOffice: { type: "senate", state: "NY" } }),
        NO_SIGNALS
      )
    ).toBe(true);
    const pastOffice = makeCharacter({
      careerHistory: [
        { type: "elected", officeLabel: "State Senate (NY)", date: new Date("2026-01-01") },
      ],
    });
    expect(isOnboardingStepComplete("file-for-race", pastOffice, NO_SIGNALS)).toBe(true);
  });

  it("found-company follows the hasCompany signal", () => {
    expect(isOnboardingStepComplete("found-company", makeCharacter(), NO_SIGNALS)).toBe(false);
    expect(
      isOnboardingStepComplete("found-company", makeCharacter(), {
        ...NO_SIGNALS,
        hasCompany: true,
      })
    ).toBe(true);
  });

  it("back-union follows the hasUnion signal", () => {
    expect(isOnboardingStepComplete("back-union", makeCharacter(), NO_SIGNALS)).toBe(false);
    expect(
      isOnboardingStepComplete("back-union", makeCharacter(), { ...NO_SIGNALS, hasUnion: true })
    ).toBe(true);
  });

  it("file-for-race: a relocation-only career history does not count", () => {
    const relocatedOnly = makeCharacter({
      careerHistory: [
        { type: "relocated", officeLabel: "New York to Texas", date: new Date("2026-01-01") },
      ],
    });
    expect(isOnboardingStepComplete("file-for-race", relocatedOnly, NO_SIGNALS)).toBe(false);
  });
});

describe("deriveOnboardingChecklist", () => {
  it("counts completed steps and reports allComplete only when every visible step is done", () => {
    const partial = deriveOnboardingChecklist(makeCharacter({ party: "3" }), {
      ...NO_SIGNALS,
      hasInvested: true,
    });
    expect(partial.total).toBe(ONBOARDING_STEP_IDS.length);
    expect(partial.completedCount).toBe(2);
    expect(partial.allComplete).toBe(false);

    const complete = deriveOnboardingChecklist(
      makeCharacter({ party: "3", onboarding: VISITED_BOTH_PAGES }),
      ALL_SIGNALS
    );
    expect(complete.completedCount).toBe(ONBOARDING_STEP_IDS.length);
    expect(complete.allComplete).toBe(true);
  });

  it("an invest-only plan shows core plus the market step and nothing political", () => {
    const invest = deriveOnboardingChecklist(makeCharacter({}), NO_SIGNALS, {
      experience: "new",
      interests: ["invest"],
    });
    expect(invest.steps.map((s) => s.id)).toEqual(["scout-state", "invest", "read-wire"]);
  });

  it("an invest-only plan reaches allComplete without ever running for office", () => {
    const invest = deriveOnboardingChecklist(
      makeCharacter({ onboarding: VISITED_BOTH_PAGES }),
      { ...NO_SIGNALS, hasInvested: true },
      { experience: "new", interests: ["invest"] }
    );
    expect(invest.completedCount).toBe(3);
    expect(invest.allComplete).toBe(true);
  });

  it("shares steps between chapters that need them", () => {
    // "invest" belongs to both invest and company; the party/campaign/seat
    // steps belong to both office and nation. Picking either chapter surfaces
    // them, and picking both does not duplicate them.
    const company = deriveOnboardingChecklist(makeCharacter({}), NO_SIGNALS, {
      experience: "new",
      interests: ["company"],
    });
    expect(company.steps.map((s) => s.id)).toContain("invest");
    expect(company.steps.map((s) => s.id)).toContain("found-company");

    const nation = deriveOnboardingChecklist(makeCharacter({}), NO_SIGNALS, {
      experience: "new",
      interests: ["nation"],
    });
    expect(nation.steps.map((s) => s.id)).toContain("join-party");

    const both = deriveOnboardingChecklist(makeCharacter({}), NO_SIGNALS, {
      experience: "new",
      interests: ["office", "nation"],
    });
    expect(both.steps.filter((s) => s.id === "join-party")).toHaveLength(1);
  });

  it("a skip plan keeps the full checklist rather than paying out for two page visits", () => {
    const skipped = deriveOnboardingChecklist(makeCharacter({}), NO_SIGNALS, {
      experience: "skip",
      interests: [],
    });
    expect(skipped.total).toBe(ONBOARDING_STEP_IDS.length);
    expect(skipped.allComplete).toBe(false);
  });

  it("defaults to the full checklist, which is what pre-plan characters keep", () => {
    const explicit = deriveOnboardingChecklist(makeCharacter({}), NO_SIGNALS, {
      experience: "new",
      interests: ["invest", "company", "union", "office", "nation"],
    });
    const defaulted = deriveOnboardingChecklist(makeCharacter({}), NO_SIGNALS);
    expect(defaulted.steps.map((s) => s.id)).toEqual(explicit.steps.map((s) => s.id));
    expect(defaulted.total).toBe(ONBOARDING_STEP_IDS.length);
  });
});

describe("isOnboardingDismissed", () => {
  it("honors the legacy boolean, the new stamp, and neither", () => {
    expect(isOnboardingDismissed({ onboardingDismissed: true })).toBe(true);
    expect(isOnboardingDismissed({ onboarding: { dismissedAt: new Date() } })).toBe(true);
    expect(isOnboardingDismissed({ onboardingDismissed: false, onboarding: {} })).toBe(false);
    expect(isOnboardingDismissed({})).toBe(false);
  });
});

describe("isTrackedOnboardingStepId", () => {
  it("accepts only the two page-visit steps", () => {
    for (const id of TRACKED_ONBOARDING_STEP_IDS) {
      expect(isTrackedOnboardingStepId(id)).toBe(true);
    }
    expect(isTrackedOnboardingStepId("join-party")).toBe(false);
    expect(isTrackedOnboardingStepId("reward")).toBe(false);
  });
});

describe("hasVotedOnAnyBill", () => {
  it("queries the embedded vote maps keyed by character id", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();
    await hasVotedOnAnyBill(db as unknown as Db, characterId);

    const key = characterId.toString();
    const billsFilter = db.collectionMocks.bills!.countDocuments.mock.calls[0][0];
    expect(billsFilter.$or).toEqual([
      { [`votes.${key}`]: { $exists: true } },
      { [`otherChamberVotes.${key}`]: { $exists: true } },
    ]);
    const stateFilter = db.collectionMocks.stateBills!.countDocuments.mock.calls[0][0];
    expect(stateFilter).toEqual({ [`votes.${key}`]: { $exists: true } });
  });

  it("is true when either national or state bills carry a vote, false when neither does", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();
    expect(await hasVotedOnAnyBill(db as unknown as Db, characterId)).toBe(false);

    db.collectionMocks.stateBills!.countDocuments.mockResolvedValue(1);
    expect(await hasVotedOnAnyBill(db as unknown as Db, characterId)).toBe(true);
  });
});

describe("loadOnboardingSignals", () => {
  it("derives invest from either share holdings or index-fund positions", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();

    const none = await loadOnboardingSignals(db as unknown as Db, characterId);
    expect(none.hasInvested).toBe(false);

    db.collectionMocks.indexFundPositions!.countDocuments.mockResolvedValue(1);
    const withFund = await loadOnboardingSignals(db as unknown as Db, characterId);
    expect(withFund.hasInvested).toBe(true);
    expect(db.collectionMocks.indexFundPositions!.countDocuments.mock.calls[0][0]).toEqual({
      holderKind: "character",
      characterId,
      units: { $gt: 0 },
    });
  });

  it("derives hasCompany from a player-held CEO seat only", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();

    const none = await loadOnboardingSignals(db as unknown as Db, characterId);
    expect(none.hasCompany).toBe(false);

    // corporations is queried twice: shareholdings first, then the CEO seat.
    // Absent ceoType counts as "character" (founding historically omitted it).
    const ceoFilter = db.collectionMocks.corporations!.countDocuments.mock.calls[1][0];
    expect(ceoFilter).toEqual({
      ceoId: characterId,
      $or: [{ ceoType: "character" }, { ceoType: { $exists: false } }],
    });
  });

  it("derives hasUnion from leading a union or funding a drive in one", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();

    expect((await loadOnboardingSignals(db as unknown as Db, characterId)).hasUnion).toBe(false);

    db.collectionMocks.unionOrganizers!.countDocuments.mockResolvedValue(1);
    expect((await loadOnboardingSignals(db as unknown as Db, characterId)).hasUnion).toBe(true);

    const fresh = createMockDb();
    fresh.collection("unions").countDocuments.mockResolvedValue(1);
    expect((await loadOnboardingSignals(fresh as unknown as Db, characterId)).hasUnion).toBe(true);
    expect(fresh.collectionMocks.unions!.countDocuments.mock.calls[0][0]).toEqual({
      ownerId: characterId,
    });
  });

  it("derives campaign-action from campaign and advertise action logs", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();
    db.collection("actionLogs").countDocuments.mockResolvedValue(1);

    const signals = await loadOnboardingSignals(db as unknown as Db, characterId);
    expect(signals.hasCampaignActed).toBe(true);
    expect(db.collectionMocks.actionLogs!.countDocuments.mock.calls[0][0]).toEqual({
      characterId,
      actionType: { $in: ["campaign", "advertise"] },
    });
  });
});
