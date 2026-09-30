import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { publicLivingConflictView } from "./publicView";
import { emptyConflictState } from "../engine";
import type { LivingConflictDef } from "../types";
import type { CrisisLeaderResponse } from "@/lib/db/types/crisis";

const def: LivingConflictDef = {
  key: "peace",
  name: "Peace",
  type: "geopolitical",
  roleResolver: () => "belligerent",
  participants: { belligerents: ["OLD"], neighbors: [], blocMembers: [], bystanders: [] },
  participantFallbacks: { OLD: ["NEW"] },
  tracks: { settlement: { initial: 20 } },
  phases: [
    {
      level: 1,
      key: "talks",
      label: "Talks",
      summary: "Negotiations continue.",
      advancePressure: 999,
      decisionTrees: {},
      events: [],
    },
    {
      level: 2,
      key: "agreement",
      label: "Agreement",
      summary: "Agreement reached.",
      advancePressure: 999,
      decisionTrees: {},
      events: [],
    },
  ],
  transitions: [{ key: "settle", fromPhase: "talks", toPhase: "agreement", conditions: [] }],
  scheduledPressures: [
    { key: "peace_talks", fromYear: 1991, untilYear: 1999, trackDeltas: { settlement: 1 } },
  ],
};

it("shows live participant fallback, authored pressure and possible transitions", () => {
  const view = publicLivingConflictView(
    def,
    { ...{ ...emptyConflictState("peace"), phaseLevel: 1, hasOpened: true }, hasOpened: true },
    new Set(["NEW"]),
    [],
    1995,
    (id) => id
  );
  expect(view).toMatchObject({
    participants: ["NEW"],
    pressures: ["peace talks"],
    nextPhases: ["Agreement"],
  });
});

describe("public commitments", () => {
  it("never serializes unrevealed covert choices or their effects", () => {
    const crisisId = new ObjectId();
    const response: CrisisLeaderResponse = {
      countryId: "NEW",
      characterId: new ObjectId(),
      characterName: "Leader",
      nodeId: "response",
      optionId: "secret_plan",
      optionLabel: "Secret operation",
      respondedAt: new Date(),
      visibility: "covert",
      responseScores: { secret: 10 },
    };
    const window = {
      crisis: {
        _id: crisisId,
        name: "Consultation",
        livingConflictEventId: "peace:talks:1:consult",
      },
      interaction: { currentNodeId: "response", resolvedAt: null, leaderResponses: [response] },
    };
    const view = publicLivingConflictView(
      def,
      { ...emptyConflictState("peace"), phaseLevel: 1, hasOpened: true },
      new Set(["NEW"]),
      [window],
      1995,
      (id) => id
    )!;
    expect(view.decisions).toEqual([{ id: crisisId.toString(), title: "Consultation" }]);
    expect(view.commitments).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/secret|Secret/);
    const revealed = publicLivingConflictView(
      def,
      { ...emptyConflictState("peace"), phaseLevel: 1, hasOpened: true },
      new Set(["NEW"]),
      [
        {
          ...window,
          interaction: {
            ...window.interaction,
            leaderResponses: [{ ...response, revealedAt: new Date() }],
          },
        },
      ],
      1995,
      (id) => id
    )!;
    expect(revealed.commitments).toEqual([{ country: "NEW", choice: "Secret operation" }]);
    expect(JSON.stringify(revealed)).not.toContain("secret_plan");
  });
  it("does not offer resolved decisions or expired scheduled pressure", () => {
    const view = publicLivingConflictView(
      def,
      { ...emptyConflictState("peace"), phaseLevel: 1, hasOpened: true },
      new Set(),
      [
        {
          crisis: {
            _id: new ObjectId(),
            name: "Closed",
            livingConflictEventId: "peace:talks:1:consult",
          },
          interaction: { currentNodeId: null, resolvedAt: new Date() },
        },
      ],
      2000,
      (id) => id
    )!;
    expect(view.decisions).toEqual([]);
    expect(view.pressures).toEqual([]);
    expect(view.participants).toEqual([]);
  });
});
