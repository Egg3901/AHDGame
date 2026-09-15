import { describe, expect, it } from "vitest";
import {
  CONVERSATION_STEP_IDS,
  buildConversationSteps,
  visibleConversationStepIds,
  type ConversationStepId,
} from "./conversationSteps";

const complete = Object.fromEntries(CONVERSATION_STEP_IDS.map((id) => [id, true])) as Record<
  ConversationStepId,
  boolean
>;
const summary = Object.fromEntries(
  CONVERSATION_STEP_IDS.map((id) => [id, `${id} answer`])
) as Record<ConversationStepId, string | null>;

describe("visibleConversationStepIds", () => {
  it("keeps the canonical order and closes with review", () => {
    expect(visibleConversationStepIds(false)).toEqual([
      "country",
      "politician",
      "region",
      "compass",
      "party",
      "review",
    ]);
    expect(visibleConversationStepIds(true)).toEqual([...CONVERSATION_STEP_IDS]);
  });

  it("includes Stats only when the RPG-stats flag is on", () => {
    expect(visibleConversationStepIds(false)).not.toContain("stats");
    expect(visibleConversationStepIds(true)).toContain("stats");
  });
});

describe("buildConversationSteps", () => {
  it("maps parent-owned completion and summaries without inventing values", () => {
    const steps = buildConversationSteps({
      regionNoun: "state",
      rpgStatsEnabled: false,
      complete: { ...complete, party: false },
      summary: { ...summary, party: null },
    });
    expect(steps.map((s) => s.id)).toEqual([
      "country",
      "politician",
      "region",
      "compass",
      "party",
      "review",
    ]);
    expect(steps.find((s) => s.id === "party")).toMatchObject({
      title: "Party",
      complete: false,
      summary: null,
    });
    expect(steps.find((s) => s.id === "region")?.title).toBe("Home state");
  });

  it("uses the region noun for UK/JP wording", () => {
    const steps = buildConversationSteps({
      regionNoun: "region",
      rpgStatsEnabled: false,
      complete,
      summary,
    });
    expect(steps.find((s) => s.id === "region")?.title).toBe("Home region");
    expect(steps.find((s) => s.id === "region")?.prompt).toContain("region");
  });

  it("keeps prompts free of em/en dashes (repo voice rule)", () => {
    for (const regionNoun of ["state", "region"]) {
      const steps = buildConversationSteps({
        regionNoun,
        rpgStatsEnabled: true,
        complete,
        summary,
      });
      for (const s of steps) {
        expect(s.title).not.toMatch(/[—–]/);
        expect(s.prompt).not.toMatch(/[—–]/);
      }
    }
  });
});
