import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ApiError } from "@/lib/api/errors";
import {
  createCrisisInteraction,
  submitCrisisDecision,
  canCharacterInteract,
  calculateCollectiveReduction,
  calculateDecisionDurationReduction,
  autoResolveCrisisInteraction,
  deriveCharacterRoles,
  resolveCharacterRoles,
} from "./interactionEngine";
import type { Crisis, CrisisInteraction, CrisisDecisionNode } from "@/lib/db/types/crisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./featureFlag", () => ({ isCrisisAidBillsEnabled: vi.fn().mockResolvedValue(false) }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  // Instantiate the collections the engine touches so we can stub them.
  ["crisisInteractions", "crises", "states", "federalBudget"].forEach((c) => db.collection(c));
  vi.clearAllMocks();
});

const TREE: CrisisDecisionNode[] = [
  {
    nodeId: "choice1",
    type: "choice",
    title: "Test Choice",
    description: "Choose",
    requiredRoles: ["headOfState"],
    timeLimitMinutes: null,
    options: [
      {
        optionId: "opt_a",
        label: "A",
        description: "to terminal",
        nextNodeId: "terminal",
        effects: [],
      },
      { optionId: "opt_b", label: "B", description: "to fund", nextNodeId: "fund", effects: [] },
    ],
  },
  {
    nodeId: "fund",
    type: "collective",
    title: "Fund",
    description: "Contribute",
    collectiveTarget: 10_000_000,
    requiredRoles: ["any"],
    timeLimitMinutes: 1440,
    options: [
      {
        optionId: "contribute_5m",
        label: "$5M",
        description: "",
        collectiveContribution: 5_000_000,
        nextNodeId: "terminal",
        effects: [],
      },
      {
        optionId: "decline",
        label: "Decline",
        description: "",
        collectiveContribution: 0,
        nextNodeId: "terminal",
        effects: [],
      },
    ],
  },
  {
    nodeId: "terminal",
    type: "terminal",
    title: "Done",
    description: "Done",
    outcomeEffects: [],
    outcomeMessage: "Resolved.",
    requiredRoles: ["any"],
    timeLimitMinutes: null,
  },
];

function makeCrisis(): Crisis {
  return {
    _id: new ObjectId(),
    name: "Test Crisis",
    description: "Test",
    scope: "country",
    countryIds: ["US"],
    regionIds: [],
    durationTurns: 6,
    effects: [],
    status: "active",
    createdBy: new ObjectId(),
    createdAt: new Date(),
    resolvedAt: null,
    startTurn: 1,
    endTurn: null,
    wireMessageOnStart: "start",
    wireMessageOnEnd: "end",
    interactionDefinition: { decisionTree: TREE, autoResolveOnExpiry: true },
  };
}

function makeInteraction(overrides: Partial<CrisisInteraction> = {}): CrisisInteraction {
  return {
    _id: new ObjectId(),
    crisisId: new ObjectId(),
    decisionTree: TREE,
    currentNodeId: "choice1",
    collectiveTarget: null,
    collectiveCurrent: 0,
    contributors: [],
    decisionDeadline: null,
    autoResolveOnExpiry: true,
    resolvedAt: null,
    resolutionPath: [],
    resolutionOutcome: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const mdb = () => db as unknown as Db;

describe("deriveCharacterRoles", () => {
  it("maps real cabinet office types to the cabinet role", () => {
    expect(deriveCharacterRoles({ type: "usCabinet" })).toContain("cabinet");
    expect(deriveCharacterRoles({ type: "parliamentaryCabinet" })).toContain("cabinet");
    expect(deriveCharacterRoles({ type: "deCabinet" })).toContain("cabinet");
  });
  it("maps heads of state and governors", () => {
    expect(deriveCharacterRoles({ type: "president" })).toContain("headOfState");
    expect(deriveCharacterRoles({ type: "primeMinister" })).toContain("headOfState");
    expect(deriveCharacterRoles({ type: "chancellor" })).toContain("headOfState");
    expect(deriveCharacterRoles({ type: "taoiseach" })).toContain("headOfState");
    expect(deriveCharacterRoles({ type: "premier" })).toContain("headOfState");
    expect(deriveCharacterRoles({ type: "ministerPresident" })).toContain("stateGovernor");
    expect(deriveCharacterRoles({ type: "governor" })).toContain("stateGovernor");
  });
  it("always includes 'any' and excludes unrelated roles", () => {
    expect(deriveCharacterRoles({ type: "house" })).toEqual(["any"]);
    expect(deriveCharacterRoles(null)).toEqual(["any"]);
  });
});

describe("resolveCharacterRoles", () => {
  it("grants headOfState to an office-seated ceremonial head of state (CN President) whose currentOffice is not a president office", async () => {
    // CN President = CCP chair, seated only via an electedOfficials row
    // (officeType "president"); currentOffice stays their primary seat.
    const xiId = new ObjectId();
    const officials = db.collection("electedOfficials");
    officials.findOne.mockImplementation(async (filter: Record<string, unknown>) => {
      if (
        filter.countryId === "CN" &&
        filter.officeType === "president" &&
        filter.characterId instanceof ObjectId &&
        (filter.characterId as ObjectId).equals(xiId)
      ) {
        return { _id: new ObjectId(), countryId: "CN", officeType: "president", characterId: xiId };
      }
      return null;
    });

    const roles = await resolveCharacterRoles(mdb(), {
      _id: xiId,
      currentOffice: { type: "npcDelegate" },
      countryId: "CN",
    });
    expect(roles).toContain("headOfState");
  });

  it("does not grant headOfState to a CN character who is not seated as President", async () => {
    // electedOfficials.findOne defaults to null (no matching HoS row).
    const roles = await resolveCharacterRoles(mdb(), {
      _id: new ObjectId(),
      currentOffice: { type: "npcDelegate" },
      countryId: "CN",
    });
    expect(roles).not.toContain("headOfState");
  });

  it("keeps granting headOfState synchronously to a real president office without a DB lookup", async () => {
    const roles = await resolveCharacterRoles(mdb(), {
      _id: new ObjectId(),
      currentOffice: { type: "president" },
      countryId: "US",
    });
    expect(roles).toContain("headOfState");
  });
});

describe("canCharacterInteract", () => {
  it("allows any character on an 'any' node", () => {
    const node = TREE[1]; // requiredRoles ["any"]
    expect(canCharacterInteract(node, ["any"])).toBe(true);
    expect(canCharacterInteract(node, ["any", "cabinet"])).toBe(true);
  });
  it("requires the matching role on a restricted node", () => {
    const node = TREE[0]; // requiredRoles ["headOfState"]
    expect(canCharacterInteract(node, ["any", "cabinet"])).toBe(false);
    expect(canCharacterInteract(node, ["any", "headOfState"])).toBe(true);
  });
});

describe("createCrisisInteraction", () => {
  it("builds the initial interaction from the first node", async () => {
    const crisis = makeCrisis();
    const result = await createCrisisInteraction(mdb(), crisis);
    expect(result).toBeTruthy();
    expect(result!.currentNodeId).toBe("choice1");
    expect(result!.decisionTree).toHaveLength(3);
    expect(result!.resolvedAt).toBeNull();
    expect(db.collectionMocks["crisisInteractions"]!.insertOne).toHaveBeenCalled();
  });

  it("returns the existing interaction instead of double-creating", async () => {
    const crisis = makeCrisis();
    const existing = makeInteraction({ crisisId: crisis._id });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValueOnce(existing);
    const result = await createCrisisInteraction(mdb(), crisis);
    expect(result).toBe(existing);
    expect(db.collectionMocks["crisisInteractions"]!.insertOne).not.toHaveBeenCalled();
  });
});

describe("submitCrisisDecision", () => {
  it("resolves the interaction when a choice leads to a terminal node", async () => {
    const interaction = makeInteraction();
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);

    const result = await submitCrisisDecision(
      mdb(),
      interaction._id,
      "opt_a",
      new ObjectId(),
      "US",
      ["any", "headOfState"]
    );

    expect(result.interaction.resolvedAt).toBeTruthy();
    expect(result.interaction.resolutionOutcome).toBe("success");
    expect(result.interaction.currentNodeId).toBeNull();
    expect(result.interaction.resolutionPath).toEqual(["opt_a", "terminal"]);
    expect(result.nextNode).toBeNull();
    const { logWireEvent } = await import("@/lib/wireEvent");
    expect(logWireEvent).toHaveBeenCalledWith("crisis_outcome", "Resolved.", expect.anything());
  });

  it("advances to a non-terminal node without resolving", async () => {
    const interaction = makeInteraction();
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);

    const result = await submitCrisisDecision(
      mdb(),
      interaction._id,
      "opt_b",
      new ObjectId(),
      "US",
      ["any", "headOfState"]
    );

    expect(result.interaction.resolvedAt).toBeNull();
    expect(result.interaction.currentNodeId).toBe("fund");
    expect(result.interaction.collectiveTarget).toBe(10_000_000);
    expect(result.nextNode?.type).toBe("collective");
  });

  it("applies an inflation effect to the affected country's federal budget", async () => {
    const inflationTree: CrisisDecisionNode[] = [
      {
        nodeId: "c",
        type: "choice",
        title: "c",
        description: "",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "shock",
            label: "",
            description: "",
            nextNodeId: "t",
            effects: [
              {
                effectType: "flat",
                targetType: "inflation",
                metricCategory: null,
                metricField: null,
                value: 1.5,
                sectorType: null,
                strategyId: null,
                label: "spike",
              },
            ],
          },
        ],
      },
      {
        nodeId: "t",
        type: "terminal",
        title: "t",
        description: "",
        outcomeEffects: [],
        outcomeMessage: "done",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ];
    const interaction = makeInteraction({ decisionTree: inflationTree, currentNodeId: "c" });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);
    db.collectionMocks["crises"]!.findOne.mockResolvedValue({
      _id: interaction.crisisId,
      scope: "country",
      countryIds: ["US"],
      regionIds: [],
    });

    await submitCrisisDecision(mdb(), interaction._id, "shock", new ObjectId(), "US", [
      "any",
      "headOfState",
    ]);

    const call = db.collectionMocks["federalBudget"]!.updateMany.mock.calls.at(-1);
    expect(call?.[0]).toEqual({ countryId: { $in: ["US"] } });
    expect(
      (call?.[1] as { $inc: Record<string, number> }).$inc["economicFactors.inflationRate"]
    ).toBe(1.5);
  });

  it("accumulates a collective contribution in place without resolving", async () => {
    const interaction = makeInteraction({ currentNodeId: "fund", collectiveTarget: 10_000_000 });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);
    db.collectionMocks["federalBudget"]!.findOne.mockResolvedValue({
      treasuryBalance: 100_000_000,
    });
    const charId = new ObjectId();

    const result = await submitCrisisDecision(
      mdb(),
      interaction._id,
      "contribute_5m",
      charId,
      "US",
      ["any"]
    );

    expect(result.interaction.contributors).toHaveLength(1);
    expect(result.interaction.contributors[0].characterId.toString()).toBe(charId.toString());
    expect(result.interaction.collectiveCurrent).toBe(5_000_000);
    expect(result.interaction.resolvedAt).toBeNull();
    expect(result.interaction.currentNodeId).toBe("fund");
    // Treasury was debited via spendFromTreasury (uses $set, not $inc).
    const debit = db.collectionMocks["federalBudget"]!.updateOne.mock.calls.at(-1);
    expect(debit?.[0]).toEqual({ countryId: "US" });
    expect((debit?.[1] as { $set: { treasuryBalance: number } }).$set.treasuryBalance).toBe(
      95_000_000
    );
  });

  it("rejects a contribution when the treasury is short", async () => {
    const interaction = makeInteraction({ currentNodeId: "fund", collectiveTarget: 10_000_000 });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);
    db.collectionMocks["federalBudget"]!.findOne.mockResolvedValue({ treasuryBalance: 1_000 });

    await expect(
      submitCrisisDecision(mdb(), interaction._id, "contribute_5m", new ObjectId(), "US", ["any"])
    ).rejects.toThrow("Insufficient treasury");
  });

  it("rejects an invalid option", async () => {
    const interaction = makeInteraction();
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);
    await expect(
      submitCrisisDecision(mdb(), interaction._id, "nope", new ObjectId(), "US", [
        "any",
        "headOfState",
      ])
    ).rejects.toThrow("Invalid option");
  });

  it("rejects when the character lacks the required role", async () => {
    const interaction = makeInteraction();
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);
    await expect(
      submitCrisisDecision(mdb(), interaction._id, "opt_a", new ObjectId(), "US", ["any"])
    ).rejects.toThrow("not authorized");
  });

  it("rejects when the interaction is already resolved", async () => {
    const interaction = makeInteraction({ resolvedAt: new Date(), currentNodeId: null });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);
    await expect(
      submitCrisisDecision(mdb(), interaction._id, "opt_a", new ObjectId(), "US", [
        "any",
        "headOfState",
      ])
    ).rejects.toThrow("already resolved");
  });
});

describe("autoResolveCrisisInteraction", () => {
  it("picks 'decline' and finalizes the terminal node as auto", async () => {
    const interaction = makeInteraction({ currentNodeId: "fund", collectiveTarget: 10_000_000 });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);

    await autoResolveCrisisInteraction(mdb(), interaction._id);

    const setArg = db.collectionMocks["crisisInteractions"]!.updateOne.mock.calls.at(-1)?.[1] as {
      $set: Record<string, unknown>;
    };
    expect(setArg.$set.resolvedAt).toBeInstanceOf(Date);
    expect(setArg.$set.resolutionOutcome).toBe("auto");
    expect(setArg.$set.currentNodeId).toBeNull();
    expect(setArg.$set.resolutionPath).toEqual(["decline", "terminal"]);
  });
});

describe("calculateCollectiveReduction", () => {
  it("returns 0 when there is no collective target", () => {
    expect(calculateCollectiveReduction(makeInteraction(), 6)).toBe(0);
  });
  it("caps at 50% of base duration", () => {
    const interaction = makeInteraction({ collectiveTarget: 100, collectiveCurrent: 150 });
    expect(calculateCollectiveReduction(interaction, 6)).toBe(3);
  });
  it("scales with funding ratio", () => {
    const interaction = makeInteraction({ collectiveTarget: 100, collectiveCurrent: 50 });
    // 6 * 0.5 * 0.5 = 1.5 → floor 1
    expect(calculateCollectiveReduction(interaction, 6)).toBe(1);
  });
});

describe("calculateDecisionDurationReduction", () => {
  // #1250: several templates advertised "reduces duration by N turns" for a
  // mechanic that did not exist, so a government spent GDP on stimulus and
  // watched the recession run its full term anyway.
  const REDUCING_TREE: CrisisDecisionNode[] = [
    {
      nodeId: "stimulus",
      type: "choice",
      title: "Recession response",
      description: "Choose",
      requiredRoles: ["headOfState"],
      timeLimitMinutes: null,
      options: [
        {
          optionId: "austerity",
          label: "Austerity",
          description: "",
          nextNodeId: null,
          effects: [],
        },
        {
          optionId: "moderate",
          label: "Moderate Stimulus",
          description: "",
          nextNodeId: null,
          durationReductionTurns: 2,
          effects: [],
        },
        {
          optionId: "large",
          label: "Large Stimulus",
          description: "",
          nextNodeId: null,
          durationReductionTurns: 4,
          effects: [],
        },
      ],
    },
  ];

  it("returns 0 before anyone has responded", () => {
    expect(
      calculateDecisionDurationReduction(
        makeInteraction({ decisionTree: REDUCING_TREE, resolutionPath: [] })
      )
    ).toBe(0);
  });

  it("credits the reduction the chosen option declares", () => {
    expect(
      calculateDecisionDurationReduction(
        makeInteraction({ decisionTree: REDUCING_TREE, resolutionPath: ["moderate"] })
      )
    ).toBe(2);
  });

  it("credits nothing for an option that declares no reduction", () => {
    expect(
      calculateDecisionDurationReduction(
        makeInteraction({ decisionTree: REDUCING_TREE, resolutionPath: ["austerity"] })
      )
    ).toBe(0);
  });

  it("ignores node ids travelled through, which are not options", () => {
    expect(
      calculateDecisionDurationReduction(
        makeInteraction({
          decisionTree: REDUCING_TREE,
          resolutionPath: ["stimulus", "large", "terminal"],
        })
      )
    ).toBe(4);
  });

  it("counts a chosen option once even when a role menu repeats it", () => {
    const dualMenu: CrisisDecisionNode[] = [
      {
        ...REDUCING_TREE[0]!,
        optionsByRole: { belligerent: REDUCING_TREE[0]!.options },
      },
    ];
    expect(
      calculateDecisionDurationReduction(
        makeInteraction({ decisionTree: dualMenu, resolutionPath: ["large"] })
      )
    ).toBe(4);
  });
});

// ── Multi-responder (global) crisis tests ───────────────────────────────────

const GLOBAL_TREE: CrisisDecisionNode[] = [
  {
    nodeId: "response",
    type: "choice",
    title: "Energy Crisis Response",
    description: "What is your government's response?",
    requiredRoles: ["headOfState"],
    timeLimitMinutes: null,
    options: [
      {
        optionId: "subsidies",
        label: "Consumer Subsidies",
        description: "Shield households",
        nextNodeId: "terminal",
        effects: [
          {
            effectType: "flat",
            targetType: "approval",
            metricCategory: "government",
            metricField: "overall",
            sectorType: null,
            strategyId: null,
            value: 0.03,
            label: "Subsidy relief",
          },
        ],
      },
      {
        optionId: "reserves",
        label: "Release Reserves",
        description: "Tap reserves",
        nextNodeId: "terminal",
        effects: [],
      },
    ],
  },
  {
    nodeId: "terminal",
    type: "terminal",
    title: "Done",
    description: "Done",
    requiredRoles: ["any"],
    timeLimitMinutes: null,
  },
];

function makeGlobalInteraction(overrides: Partial<CrisisInteraction> = {}): CrisisInteraction {
  return makeInteraction({ decisionTree: GLOBAL_TREE, currentNodeId: "response", ...overrides });
}

function stubGlobalCrisis(interaction: CrisisInteraction) {
  db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);
  db.collectionMocks["crises"]!.findOne.mockResolvedValue({
    ...makeCrisis(),
    _id: interaction.crisisId,
    scope: "global",
    interactionDefinition: { decisionTree: GLOBAL_TREE, autoResolveOnExpiry: true },
  });
  // No states needed unless effects are applied; characters.findOne → null name.
  db.collection("characters");
}

describe("submitCrisisDecision — multi-responder global crises", () => {
  it("records a per-leader response without resolving the interaction", async () => {
    const interaction = makeGlobalInteraction();
    stubGlobalCrisis(interaction);

    const result = await submitCrisisDecision(
      mdb(),
      interaction._id,
      "reserves",
      new ObjectId(),
      "US",
      ["headOfState"]
    );

    // Stays open on the same node — other leaders can still respond.
    expect(result.interaction.resolvedAt).toBeNull();
    expect(result.nextNode?.nodeId).toBe("response");
    expect(result.interaction.leaderResponses).toHaveLength(1);
    expect(result.interaction.leaderResponses?.[0]).toMatchObject({
      countryId: "US",
      optionId: "reserves",
      optionLabel: "Release Reserves",
    });

    // Persisted via $push, never a resolving $set.
    const call = db.collectionMocks["crisisInteractions"]!.updateOne.mock.calls.at(-1)?.[1] as {
      $push?: Record<string, unknown>;
      $set?: Record<string, unknown>;
    };
    expect(call.$push?.leaderResponses).toBeDefined();
    expect(call.$set?.resolvedAt).toBeUndefined();
  });

  it("applies the option's effects scoped to the responder's own country", async () => {
    const interaction = makeGlobalInteraction();
    stubGlobalCrisis(interaction);
    db.collectionMocks["states"]!.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([{ _id: "US-CA" }]) }),
      toArray: vi.fn().mockResolvedValue([{ _id: "US-CA" }]),
    });

    await submitCrisisDecision(mdb(), interaction._id, "subsidies", new ObjectId(), "US", [
      "headOfState",
    ]);

    // Only the responder's country's states were resolved for the effect.
    expect(db.collectionMocks["states"]!.find).toHaveBeenCalledWith(
      { countryId: "US" },
      expect.anything()
    );
  });

  it("rejects a second response from a country that already responded", async () => {
    const interaction = makeGlobalInteraction({
      leaderResponses: [
        {
          countryId: "US",
          characterId: new ObjectId(),
          characterName: "Prior Leader",
          nodeId: "response",
          optionId: "subsidies",
          optionLabel: "Consumer Subsidies",
          respondedAt: new Date(),
        },
      ],
    });
    stubGlobalCrisis(interaction);

    await expect(
      submitCrisisDecision(mdb(), interaction._id, "reserves", new ObjectId(), "US", [
        "headOfState",
      ])
    ).rejects.toThrow(/already responded/i);
  });
});

// ── Aid node tests ──────────────────────────────────────────────────────────

const AID_TREE: CrisisDecisionNode[] = [
  {
    nodeId: "aid_node",
    type: "aid",
    title: "International Aid",
    description: "Send aid to the affected region",
    requiredRoles: ["headOfState"],
    timeLimitMinutes: null,
    aidMaxPctGdp: 0.02,
    aidDefaultPctGdp: 0.005,
    options: [
      {
        optionId: "aid_skip",
        label: "Decline / No Aid",
        description: "Do not send aid",
        nextNodeId: "aid_terminal",
        effects: [],
      },
      {
        optionId: "aid_contribute",
        label: "Send Aid",
        description: "Pledge aid to the affected country",
        nextNodeId: "aid_terminal",
        effects: [],
      },
    ],
  },
  {
    nodeId: "aid_terminal",
    type: "terminal",
    title: "Aid Response Complete",
    description: "The international aid response has concluded.",
    outcomeEffects: [],
    outcomeMessage: "Aid response resolved.",
    requiredRoles: ["any"],
    timeLimitMinutes: null,
  },
];

describe("submitCrisisDecision — aid node (decline path)", () => {
  it("resolves the interaction when aid_skip is submitted on an aid-type node", async () => {
    const interaction = makeInteraction({
      decisionTree: AID_TREE,
      currentNodeId: "aid_node",
    });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);

    const result = await submitCrisisDecision(
      mdb(),
      interaction._id,
      "aid_skip",
      new ObjectId(),
      "US",
      ["any", "headOfState"]
    );

    expect(result.interaction.resolvedAt).toBeTruthy();
    expect(result.interaction.resolutionOutcome).toBe("success");
    expect(result.interaction.currentNodeId).toBeNull();
    expect(result.interaction.resolutionPath).toContain("aid_skip");
    expect(result.nextNode).toBeNull();
  });

  it("rejects submission of aid_skip when the character lacks headOfState role", async () => {
    const interaction = makeInteraction({
      decisionTree: AID_TREE,
      currentNodeId: "aid_node",
    });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);

    await expect(
      submitCrisisDecision(mdb(), interaction._id, "aid_skip", new ObjectId(), "US", [
        "any",
        "cabinet",
      ])
    ).rejects.toThrow("not authorized");
  });
});

describe("createCrisisInteraction — aid node transform (flag ON)", () => {
  it("transforms a choice node with aid_contribute option into an aid node when flag is enabled", async () => {
    const { isCrisisAidBillsEnabled } = await import("./featureFlag");
    vi.mocked(isCrisisAidBillsEnabled).mockResolvedValueOnce(true);

    const templateTree: CrisisDecisionNode[] = [
      {
        nodeId: "response",
        type: "choice",
        title: "Earthquake Response",
        description: "",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_civilian",
            label: "Civilian Response",
            description: "",
            nextNodeId: "intl_aid",
            effects: [],
          },
        ],
      },
      {
        nodeId: "intl_aid",
        type: "choice",
        title: "International Aid",
        description: "",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "aid_contribute",
            label: "Send Aid",
            description: "",
            nextNodeId: "terminal",
            effects: [],
          },
          {
            optionId: "aid_skip",
            label: "No Aid",
            description: "",
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Resolved",
        description: "",
        outcomeEffects: [],
        outcomeMessage: "Done.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ];

    const crisis: Crisis = {
      _id: new ObjectId(),
      name: "Earthquake",
      description: "Test",
      scope: "country",
      countryIds: ["US"],
      regionIds: [],
      durationTurns: 6,
      effects: [],
      status: "active",
      createdBy: new ObjectId(),
      createdAt: new Date(),
      resolvedAt: null,
      startTurn: 1,
      endTurn: null,
      wireMessageOnStart: "start",
      wireMessageOnEnd: "end",
      interactionDefinition: { decisionTree: templateTree, autoResolveOnExpiry: true },
    };

    const result = await createCrisisInteraction(mdb(), crisis);

    // The intl_aid node should be transformed into an "aid" type
    const aidNode = result!.decisionTree.find((n) => n.nodeId === "intl_aid");
    expect(aidNode).toBeDefined();
    expect(aidNode!.type).toBe("aid");
    expect(aidNode!.requiredRoles).toEqual(["headOfState"]);
    expect(aidNode!.aidMaxPctGdp).toBe(0.02);
    expect(aidNode!.aidDefaultPctGdp).toBe(0.005);

    // The aid_skip option should be first
    expect(aidNode!.options![0].optionId).toBe("aid_skip");
    expect(aidNode!.options![1].optionId).toBe("aid_contribute");

    // The first node (response) should NOT be transformed
    const responseNode = result!.decisionTree.find((n) => n.nodeId === "response");
    expect(responseNode!.type).toBe("choice");

    // The original template tree must NOT be mutated
    const originalAidNode = templateTree.find((n) => n.nodeId === "intl_aid");
    expect(originalAidNode!.type).toBe("choice");
  });

  it("leaves the tree unchanged when the flag is OFF", async () => {
    // isCrisisAidBillsEnabled is mocked to return false by default
    const templateTree: CrisisDecisionNode[] = [
      {
        nodeId: "aid_choice",
        type: "choice",
        title: "Aid",
        description: "",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "aid_contribute",
            label: "Send Aid",
            description: "",
            nextNodeId: "terminal",
            effects: [],
          },
          {
            optionId: "aid_skip",
            label: "No Aid",
            description: "",
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Done",
        description: "",
        outcomeEffects: [],
        outcomeMessage: "Done.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ];

    const crisis: Crisis = {
      _id: new ObjectId(),
      name: "Test",
      description: "Test",
      scope: "country",
      countryIds: ["US"],
      regionIds: [],
      durationTurns: 6,
      effects: [],
      status: "active",
      createdBy: new ObjectId(),
      createdAt: new Date(),
      resolvedAt: null,
      startTurn: 1,
      endTurn: null,
      wireMessageOnStart: "start",
      wireMessageOnEnd: "end",
      interactionDefinition: { decisionTree: templateTree, autoResolveOnExpiry: true },
    };

    const result = await createCrisisInteraction(mdb(), crisis);

    // Node should remain as "choice" type (not transformed)
    const aidNode = result!.decisionTree.find((n) => n.nodeId === "aid_choice");
    expect(aidNode!.type).toBe("choice");
  });
});

// ── Rejection status codes (ticket #1183) ───────────────────────────────────
// A blocked decision has to reach the player as a readable rejection. The API
// routes hand every throw to handleRouteError, which maps anything that is not
// an ApiError to a generic 500 "Internal server error" AND reports it to
// Sentry as a fault, so the engine's own guards must carry their own status.

describe("submitCrisisDecision — rejection status codes", () => {
  it("rejects a decision from an unauthorized character as a 403", async () => {
    const interaction = makeInteraction();
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);

    const err = await submitCrisisDecision(mdb(), interaction._id, "opt_a", new ObjectId(), "US", [
      "any",
    ]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toMatch(/not authorized/i);
  });

  it("rejects an unknown option as a 400", async () => {
    const interaction = makeInteraction();
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);

    const err = await submitCrisisDecision(mdb(), interaction._id, "nope", new ObjectId(), "US", [
      "any",
      "headOfState",
    ]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });

  it("rejects a decision on an already-resolved crisis as a 409", async () => {
    const interaction = makeInteraction({ resolvedAt: new Date(), currentNodeId: null });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);

    const err = await submitCrisisDecision(mdb(), interaction._id, "opt_a", new ObjectId(), "US", [
      "any",
      "headOfState",
    ]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
  });

  it("rejects a missing interaction as a 404", async () => {
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(null);

    const err = await submitCrisisDecision(mdb(), new ObjectId(), "opt_a", new ObjectId(), "US", [
      "headOfState",
    ]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });

  it("rejects a repeat response from a country that already answered as a 409", async () => {
    const interaction = makeGlobalInteraction({
      leaderResponses: [
        {
          countryId: "US",
          characterId: new ObjectId(),
          characterName: "Prior Leader",
          nodeId: "response",
          optionId: "subsidies",
          optionLabel: "Consumer Subsidies",
          respondedAt: new Date(),
        },
      ],
    });
    stubGlobalCrisis(interaction);

    const err = await submitCrisisDecision(
      mdb(),
      interaction._id,
      "reserves",
      new ObjectId(),
      "US",
      ["headOfState"]
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toMatch(/already responded/i);
  });

  it("rejects a contribution the treasury cannot cover as a 400", async () => {
    const interaction = makeInteraction({ currentNodeId: "fund", collectiveTarget: 10_000_000 });
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);
    db.collectionMocks["federalBudget"]!.findOne.mockResolvedValue({ treasuryBalance: 1_000 });

    const err = await submitCrisisDecision(
      mdb(),
      interaction._id,
      "contribute_5m",
      new ObjectId(),
      "US",
      ["any"]
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toMatch(/insufficient treasury/i);
  });
});

// ── Countries with no part in a global response (audit, ticket #1183) ───────
// optionsForGlobalResponder returns [] for a country that holds no role, so the
// option lookup misses and the responder was told "Invalid option" — the option
// is fine, their nation simply is not party to the response. Same class of
// misleading refusal the ticket is about.

describe("submitCrisisDecision — a country with no role in the response", () => {
  function stubResponseCrisis(
    interaction: CrisisInteraction,
    roleByCountry: Record<string, string>
  ) {
    db.collectionMocks["crisisInteractions"]!.findOne.mockResolvedValue(interaction);
    db.collectionMocks["crises"]!.findOne.mockResolvedValue({
      ...makeCrisis(),
      _id: interaction.crisisId,
      scope: "global",
      interactionDefinition: { decisionTree: GLOBAL_TREE, autoResolveOnExpiry: true },
      globalResponse: {
        conflictKey: "berlin",
        eventKey: "berlin_bloc",
        roleByCountry,
        defaultOptionIdByRole: { bloc: "reserves" },
        outcomes: [],
        defaultOutcomeId: "stalemate",
      },
    });
    db.collection("characters");
  }

  it("refuses with 403 naming the real reason, not 'Invalid option'", async () => {
    const interaction = makeGlobalInteraction();
    stubResponseCrisis(interaction, { GB: "bloc" });

    const err = await submitCrisisDecision(
      mdb(),
      interaction._id,
      "reserves",
      new ObjectId(),
      "US",
      ["headOfState"]
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).not.toMatch(/invalid option/i);
    expect((err as ApiError).message).toMatch(/not one of the governments|no role/i);
  });

  it("still rejects a genuinely unknown option from a participating country as 400", async () => {
    const interaction = makeGlobalInteraction();
    stubResponseCrisis(interaction, { US: "bloc" });

    const err = await submitCrisisDecision(
      mdb(),
      interaction._id,
      "not_an_option",
      new ObjectId(),
      "US",
      ["headOfState"]
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toMatch(/invalid option/i);
  });
});
