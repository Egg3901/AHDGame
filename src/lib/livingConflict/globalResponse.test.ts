import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type {
  Crisis,
  CrisisDecisionNode,
  CrisisInteraction,
  GlobalResponseOutcome,
} from "@/lib/db/types/crisis";
import {
  globalResponseRoleFor,
  optionsForGlobalResponder,
  scoresForResponses,
  scoresForGlobalResponse,
  selectGlobalResponseOutcome,
  visibleGlobalResponses,
} from "./globalResponse";
import { VIETNAM_DEF } from "./defs/vietnam";
import { allLivingConflictDefs } from "./registry";

const outcomes: GlobalResponseOutcome[] = [
  {
    outcomeId: "talks",
    label: "Talks",
    description: "Talks open.",
    priority: 20,
    conditions: [{ axis: "mediation", min: 4 }],
    wireMessage: "Talks open.",
  },
  {
    outcomeId: "war",
    label: "War",
    description: "The crisis widens.",
    priority: 10,
    conditions: [{ axis: "escalation", min: 4 }],
    wireMessage: "The crisis widens.",
  },
  {
    outcomeId: "stale",
    label: "Stalemate",
    description: "Nothing changes.",
    priority: 0,
    conditions: [],
    wireMessage: "Nothing changes.",
  },
];

function crisis(): Pick<Crisis, "globalResponse"> {
  return {
    globalResponse: {
      conflictKey: "vietnam",
      eventKey: "test",
      roleByCountry: { US: "backer_a", IE: "bystander" },
      defaultOptionIdByRole: { backer_a: "commit", bystander: "mediate" },
      outcomes,
      defaultOutcomeId: "stale",
    },
  };
}

const node: CrisisDecisionNode = {
  nodeId: "response",
  type: "choice",
  title: "Response",
  description: "Choose.",
  options: [],
  optionsByRole: {
    backer_a: [
      {
        optionId: "commit",
        label: "Commit",
        description: "Commit.",
        effects: [],
        nextNodeId: null,
        responseScores: { escalation: 3 },
      },
    ],
    bystander: [
      {
        optionId: "mediate",
        label: "Mediate",
        description: "Mediate.",
        effects: [],
        nextNodeId: null,
        responseScores: { mediation: 3 },
      },
    ],
  },
  requiredRoles: ["headOfState"],
  timeLimitMinutes: 60,
};

describe("global response module", () => {
  it("exposes only the menu authored for the country's role", () => {
    expect(globalResponseRoleFor(crisis(), "US")).toBe("backer_a");
    expect(
      optionsForGlobalResponder(crisis(), node, "US").map((option) => option.optionId)
    ).toEqual(["commit"]);
    expect(
      optionsForGlobalResponder(crisis(), node, "IE").map((option) => option.optionId)
    ).toEqual(["mediate"]);
    expect(optionsForGlobalResponder(crisis(), node, "JP")).toEqual([]);
  });

  it("sums every response axis without requiring identical menus", () => {
    const responses: NonNullable<CrisisInteraction["leaderResponses"]> = [
      {
        countryId: "US",
        characterId: new ObjectId(),
        characterName: "A",
        nodeId: "response",
        optionId: "commit",
        optionLabel: "Commit",
        responseScores: { escalation: 3, aid: 1 },
        respondedAt: new Date(),
      },
      {
        countryId: "IE",
        characterId: new ObjectId(),
        characterName: "B",
        nodeId: "response",
        optionId: "mediate",
        optionLabel: "Mediate",
        responseScores: { mediation: 3, aid: 2 },
        respondedAt: new Date(),
      },
    ];
    expect(scoresForResponses(responses)).toEqual({ escalation: 3, aid: 3, mediation: 3 });
  });

  it("adds the authored default posture for governments that do not answer", () => {
    const interaction = {
      currentNodeId: "response",
      decisionTree: [node],
      leaderResponses: [
        {
          countryId: "US",
          characterId: new ObjectId(),
          characterName: "A",
          nodeId: "response",
          optionId: "commit",
          optionLabel: "Commit",
          responseScores: { escalation: 3 },
          respondedAt: new Date(),
        },
      ],
    };
    expect(scoresForGlobalResponse(crisis(), interaction)).toEqual({
      escalation: 3,
      mediation: 3,
    });
  });

  it("selects the highest-priority matching outcome and falls back deterministically", () => {
    expect(
      selectGlobalResponseOutcome(outcomes, "stale", { mediation: 5, escalation: 8 }).outcomeId
    ).toBe("talks");
    expect(selectGlobalResponseOutcome(outcomes, "stale", { escalation: 5 }).outcomeId).toBe("war");
    expect(selectGlobalResponseOutcome(outcomes, "stale", {}).outcomeId).toBe("stale");
  });

  it("keeps covert responses private until they are exposed", () => {
    const covert = {
      countryId: "RU",
      characterId: new ObjectId(),
      characterName: "A",
      nodeId: "response",
      optionId: "covert_supply",
      optionLabel: "Covert Supply",
      effects: [],
      responseScores: { escalation: 2 },
      visibility: "covert" as const,
      campaignCommitment: { kind: "covert" as const, scale: 5 },
      respondedAt: new Date(),
    };

    expect(visibleGlobalResponses([covert], "RU")[0]).toMatchObject({
      optionId: "covert_supply",
      optionLabel: "Covert Supply",
    });
    expect(visibleGlobalResponses([covert], "US")[0]).toMatchObject({
      optionId: "undisclosed",
      optionLabel: "Undisclosed action",
      responseScores: undefined,
      campaignCommitment: undefined,
    });
    expect(visibleGlobalResponses([{ ...covert, revealedAt: new Date() }], "US")[0].optionId).toBe(
      "covert_supply"
    );
  });
});

describe("1.3 authored catalog", () => {
  it("gives every Vietnam phase an entry response and a recurring world consultation", () => {
    for (const phase of VIETNAM_DEF.phases) {
      expect(phase.events.some((event) => event.trigger?.onPhaseEnter && event.response)).toBe(
        true
      );
      expect(phase.events.some((event) => event.trigger?.everyTurns === 24 && event.response)).toBe(
        true
      );
      const response = phase.events.find((event) => event.response)?.response;
      expect(Object.keys(response?.decisionTrees ?? {})).toEqual(
        expect.arrayContaining(["backer_a", "backer_b", "neighbor", "bloc", "bystander"])
      );
    }
  });

  it("authors every 1.3 geopolitical chain through response-bearing events", () => {
    const defs = allLivingConflictDefs().filter((def) => def.key !== "pandemic");
    expect(defs.map((def) => def.key)).toEqual(
      expect.arrayContaining([
        "vietnam",
        "berlin",
        "congo",
        "suez_aftermath",
        "oil_disruption",
        "nuclear_incident",
      ])
    );
    for (const def of defs) {
      expect(def.phases.every((phase) => phase.events.some((event) => event.response))).toBe(true);
    }
  });
});
