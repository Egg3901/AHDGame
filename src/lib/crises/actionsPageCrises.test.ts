import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  shouldShowCrisisOnActionsPage,
  sanitizeCrisisForActionsPage,
  compareActionsPageCrises,
  type ActionsPageCrisisEntry,
} from "./actionsPageCrises";
import type { Crisis, CrisisDecisionNode } from "@/lib/db/types/crisis";

function makeCrisis(effectsCount = 1): Crisis {
  return {
    _id: new ObjectId(),
    name: "Test",
    description: "Test",
    scope: "country",
    countryIds: ["US"],
    regionIds: [],
    durationTurns: 6,
    effects: Array.from({ length: effectsCount }, () => ({
      effectType: "tick" as const,
      targetType: "metric" as const,
      metricCategory: "economy",
      metricField: "gdp",
      sectorType: null,
      strategyId: null,
      value: -0.01,
      label: "test",
    })),
    status: "active",
    createdBy: new ObjectId(),
    createdAt: new Date(),
    resolvedAt: null,
    startTurn: 1,
    endTurn: null,
    wireMessageOnStart: "",
    wireMessageOnEnd: "",
  };
}

const headOfStateNode: CrisisDecisionNode = {
  nodeId: "stimulus",
  type: "choice",
  title: "Recession Response",
  description: "Choose",
  requiredRoles: ["headOfState"],
  timeLimitMinutes: null,
  options: [],
};

const collectiveNode: CrisisDecisionNode = {
  nodeId: "fund",
  type: "collective",
  title: "Fund",
  description: "Contribute",
  collectiveTarget: 1_000_000,
  requiredRoles: ["any"],
  timeLimitMinutes: null,
  options: [],
};

function entry(overrides: Partial<ActionsPageCrisisEntry> = {}): ActionsPageCrisisEntry {
  return {
    crisis: makeCrisis(),
    interaction: null,
    currentNode: null,
    canInteract: false,
    ...overrides,
  };
}

describe("shouldShowCrisisOnActionsPage", () => {
  it("still shows a local crisis whose decision the character cannot take", () => {
    // The prompt is not theirs, but the crisis is ticking effects at their
    // country. `sanitizeCrisisForActionsPage` strips the prompt; the card stays.
    expect(
      shouldShowCrisisOnActionsPage(
        entry({ currentNode: headOfStateNode, canInteract: false }),
        true
      )
    ).toBe(true);
  });

  it("hides a local crisis the character cannot act on that has no effects", () => {
    expect(
      shouldShowCrisisOnActionsPage(
        entry({ crisis: makeCrisis(0), currentNode: headOfStateNode, canInteract: false }),
        true
      )
    ).toBe(false);
  });

  it("shows local crises with an actionable decision", () => {
    expect(
      shouldShowCrisisOnActionsPage(
        entry({ currentNode: headOfStateNode, canInteract: true }),
        true
      )
    ).toBe(true);
  });

  it("shows local ambient effect-only crises", () => {
    expect(shouldShowCrisisOnActionsPage(entry(), true)).toBe(true);
  });

  it("hides local crises with no effects and no actionable decision", () => {
    expect(shouldShowCrisisOnActionsPage(entry({ crisis: makeCrisis(0) }), true)).toBe(false);
  });

  it("keeps an answered local crisis on the page while it is still ticking", () => {
    // The head of state has answered, so there is nothing left to decide — but
    // the crisis runs for many more turns and keeps hitting every player in the
    // country. It must not vanish the moment the prompt is resolved.
    expect(
      shouldShowCrisisOnActionsPage(
        entry({
          interaction: {
            _id: new ObjectId(),
            crisisId: new ObjectId(),
            decisionTree: [],
            currentNodeId: null,
            collectiveTarget: null,
            collectiveCurrent: 0,
            contributors: [],
            decisionDeadline: null,
            autoResolveOnExpiry: true,
            resolvedAt: new Date(),
            resolutionPath: [],
            resolutionOutcome: "auto",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        true
      )
    ).toBe(true);
  });

  it("hides an answered local crisis that has no effects left to feel", () => {
    expect(
      shouldShowCrisisOnActionsPage(
        entry({
          crisis: makeCrisis(0),
          interaction: {
            _id: new ObjectId(),
            crisisId: new ObjectId(),
            decisionTree: [],
            currentNodeId: null,
            collectiveTarget: null,
            collectiveCurrent: 0,
            contributors: [],
            decisionDeadline: null,
            autoResolveOnExpiry: true,
            resolvedAt: new Date(),
            resolutionPath: [],
            resolutionOutcome: "auto",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        true
      )
    ).toBe(false);
  });

  it("shows non-local collective nodes only when the character can contribute", () => {
    expect(
      shouldShowCrisisOnActionsPage(
        entry({ currentNode: collectiveNode, canInteract: true }),
        false
      )
    ).toBe(true);
    expect(
      shouldShowCrisisOnActionsPage(
        entry({ currentNode: collectiveNode, canInteract: false }),
        false
      )
    ).toBe(false);
  });
});

describe("sanitizeCrisisForActionsPage", () => {
  it("strips currentNode when the character cannot interact", () => {
    const raw = entry({ currentNode: headOfStateNode, canInteract: false });
    expect(sanitizeCrisisForActionsPage(raw).currentNode).toBeNull();
  });

  it("keeps currentNode when the character can interact", () => {
    const raw = entry({ currentNode: headOfStateNode, canInteract: true });
    expect(sanitizeCrisisForActionsPage(raw).currentNode).toBe(headOfStateNode);
  });
});

describe("sanitizeCrisisForActionsPage — everything about a decision that is not theirs", () => {
  function withInteraction(canInteract: boolean): ActionsPageCrisisEntry {
    return entry({
      canInteract,
      currentNode: headOfStateNode,
      crisis: {
        ...makeCrisis(),
        interactionDefinition: { decisionTree: [headOfStateNode], autoResolveOnExpiry: true },
      },
      interaction: {
        _id: new ObjectId(),
        crisisId: new ObjectId(),
        decisionTree: [headOfStateNode],
        currentNodeId: "stimulus",
        collectiveTarget: null,
        collectiveCurrent: 0,
        contributors: [],
        leaderResponses: [
          {
            countryId: "RU",
            characterId: new ObjectId(),
            characterName: "Someone Else",
            nodeId: "stimulus",
            optionId: "stimulus_austerity",
            optionLabel: "Austerity",
            visibility: "covert",
            respondedAt: new Date(),
          },
        ],
        decisionDeadline: null,
        autoResolveOnExpiry: true,
        resolvedAt: null,
        resolutionPath: [],
        resolutionOutcome: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  it("drops the live interaction, so no response ledger reaches a bystander", () => {
    expect(sanitizeCrisisForActionsPage(withInteraction(false)).interaction).toBeNull();
  });

  it("drops the authored decision tree an ambient card never renders", () => {
    expect(
      sanitizeCrisisForActionsPage(withInteraction(false)).crisis.interactionDefinition
    ).toBeUndefined();
  });

  it("leaves the crisis itself intact for the ambient card to render", () => {
    const sanitized = sanitizeCrisisForActionsPage(withInteraction(false));
    expect(sanitized.crisis.name).toBe("Test");
    expect(sanitized.crisis.effects).toHaveLength(1);
  });

  it("keeps all of it for a character who can act", () => {
    const kept = sanitizeCrisisForActionsPage(withInteraction(true));
    expect(kept.interaction).not.toBeNull();
    expect(kept.crisis.interactionDefinition).toBeDefined();
    expect(kept.currentNode).toBe(headOfStateNode);
  });
});

describe("compareActionsPageCrises", () => {
  function at(startTurn: number, canInteract = false): ActionsPageCrisisEntry {
    return entry({ crisis: { ...makeCrisis(), startTurn }, canInteract });
  }

  it("puts a decision the character can take above ambient cards", () => {
    const ambientNewer = at(100);
    const actionableOlder = at(1, true);
    expect([ambientNewer, actionableOlder].sort(compareActionsPageCrises)[0]).toBe(actionableOlder);
  });

  it("orders the rest newest first", () => {
    const older = at(10);
    const newer = at(20);
    expect([older, newer].sort(compareActionsPageCrises)).toEqual([newer, older]);
  });

  it("is a total order, so an ETagged feed does not reshuffle between polls", () => {
    const a = at(5);
    const b = at(5);
    const first = [a, b].sort(compareActionsPageCrises);
    const second = [b, a].sort(compareActionsPageCrises);
    expect(first.map((e) => e.crisis._id.toString())).toEqual(
      second.map((e) => e.crisis._id.toString())
    );
  });
});
