import { describe, expect, it } from "vitest";
import {
  DEFAULT_TUTORIAL_PLAN,
  TUTORIAL_INTERESTS,
  chapterIdsForPlan,
  chapterVisibleForPlan,
  normalizeInterests,
  resolveTutorialPlan,
  stepVisibleForExperience,
  type TutorialPlan,
} from "./tutorialPlan";

describe("resolveTutorialPlan", () => {
  it("defaults an unknown character to the full new-player tour", () => {
    expect(resolveTutorialPlan(undefined)).toEqual(DEFAULT_TUTORIAL_PLAN);
    expect(resolveTutorialPlan({})).toEqual(DEFAULT_TUTORIAL_PLAN);
  });

  it("migrates the legacy politics track to the office chapter", () => {
    expect(resolveTutorialPlan({ tutorialTrack: "politics" })).toEqual({
      experience: "new",
      interests: ["office"],
    });
  });

  it("migrates the legacy complete track to every interest", () => {
    expect(resolveTutorialPlan({ tutorialTrack: "complete" })).toEqual({
      experience: "new",
      interests: [...TUTORIAL_INTERESTS],
    });
  });

  it("prefers a stored plan over the legacy track", () => {
    const plan = resolveTutorialPlan({
      tutorial: { experience: "returning", interests: ["union"] },
      tutorialTrack: "politics",
    });
    expect(plan).toEqual({ experience: "returning", interests: ["union"] });
  });

  it("keeps skip with no interests", () => {
    expect(resolveTutorialPlan({ tutorial: { experience: "skip", interests: [] } })).toEqual({
      experience: "skip",
      interests: [],
    });
  });

  it("falls back to the full tour when a non-skip plan has no usable interests", () => {
    const plan = resolveTutorialPlan({
      tutorial: { experience: "new", interests: ["not-a-thing"] },
    });
    expect(plan.interests).toEqual([...TUTORIAL_INTERESTS]);
  });

  it("ignores a malformed tutorial block", () => {
    expect(resolveTutorialPlan({ tutorial: { experience: "expert" } })).toEqual(
      DEFAULT_TUTORIAL_PLAN
    );
  });
});

describe("normalizeInterests", () => {
  it("dedupes, drops junk, and returns canonical selector order", () => {
    expect(normalizeInterests(["nation", "invest", "invest", "nope"])).toEqual([
      "invest",
      "nation",
    ]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(normalizeInterests(undefined)).toEqual([]);
    expect(normalizeInterests("invest")).toEqual([]);
  });
});

describe("chapterIdsForPlan", () => {
  it("runs no chapters for skip", () => {
    expect(chapterIdsForPlan({ experience: "skip", interests: [] })).toEqual([]);
  });

  it("leads with core for a new player and closes with what's new", () => {
    expect(chapterIdsForPlan({ experience: "new", interests: ["union"] })).toEqual([
      "core",
      "union",
      "whats-new",
    ]);
  });

  it("leads with what's-new for a returning player, and never repeats it", () => {
    const chapters = chapterIdsForPlan({ experience: "returning", interests: ["invest"] });
    expect(chapters).toEqual(["whats-new", "core", "invest"]);
    expect(chapters.filter((id) => id === "whats-new")).toHaveLength(1);
  });

  it("uses tour order, not selection order, for interest chapters", () => {
    expect(
      chapterIdsForPlan({ experience: "new", interests: ["nation", "union", "office"] })
    ).toEqual(["core", "office", "union", "nation", "whats-new"]);
  });

  it("runs every chapter when every interest is selected", () => {
    expect(chapterIdsForPlan({ experience: "new", interests: [...TUTORIAL_INTERESTS] })).toEqual([
      "core",
      "office",
      "invest",
      "company",
      "union",
      "nation",
      "whats-new",
    ]);
  });
});

describe("chapterVisibleForPlan", () => {
  it("hides an unselected interest chapter", () => {
    const plan: TutorialPlan = { experience: "new", interests: ["invest"] };
    expect(chapterVisibleForPlan("invest", plan)).toBe(true);
    expect(chapterVisibleForPlan("union", plan)).toBe(false);
    expect(chapterVisibleForPlan("core", plan)).toBe(true);
    // What's new now runs for everyone; only the placement differs.
    expect(chapterVisibleForPlan("whats-new", plan)).toBe(true);
    expect(chapterVisibleForPlan("whats-new", { experience: "skip", interests: [] })).toBe(false);
  });
});

describe("stepVisibleForExperience", () => {
  it("drops fundamentals for a returning player and keeps do-it steps", () => {
    expect(stepVisibleForExperience({ fundamental: true }, "returning")).toBe(false);
    expect(stepVisibleForExperience({}, "returning")).toBe(true);
  });

  it("keeps everything for a new player", () => {
    expect(stepVisibleForExperience({ fundamental: true }, "new")).toBe(true);
  });

  it("shows nothing for skip", () => {
    expect(stepVisibleForExperience({}, "skip")).toBe(false);
  });
});
