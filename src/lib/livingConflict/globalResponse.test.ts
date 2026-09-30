import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  Crisis,
  CrisisDecisionNode,
  CrisisDecisionOption,
  CrisisInteraction,
  GlobalResponseOutcome,
} from "@/lib/db/types/crisis";
import { ApiError } from "@/lib/api/errors";
import {
  createAsyncIterableCursor,
  createMockDb,
  type MockCollection,
} from "@/lib/test-utils/mockDb";
import {
  recordGlobalResponseCommitment,
  globalResponseRoleFor,
  loadCampaignCapability,
  optionsForGlobalResponder,
  prepareGlobalResponseOption,
  scoresForResponses,
  scoresForGlobalResponse,
  selectGlobalResponseOutcome,
  visibleGlobalResponses,
} from "./globalResponse";
import { EQUIPMENT_TRACK_MAX } from "@/lib/military/arsenal";
import { VIETNAM_DEF } from "./defs/vietnam";
import { YUGOSLAVIA_DEF } from "./defs/yugoslavia";
import { allLivingConflictDefs } from "./registry";
import { emptyConflictState } from "./engine";
import { normalizeCampaignState } from "./campaign";
import type { LivingConflictState } from "./types";

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
    const defs = allLivingConflictDefs().filter((def) =>
      def.phases.some((phase) => phase.events.some((event) => event.response))
    );
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

// ── Capacity gate (ticket #1183) ────────────────────────────────────────────
// A nation that cannot meet an option's campaign requirement is being refused,
// not failing. The refusal travels through handleRouteError, which turns any
// non-ApiError into a generic 500 "Internal server error", so the reasons the
// UI already knows how to render never reach the player.

describe("prepareGlobalResponseOption — capacity refusals", () => {
  const CRISIS = {
    globalResponse: {
      conflictKey: "berlin",
      eventKey: "berlin_bloc",
      roleByCountry: { US: "bloc" as const },
      defaultOptionIdByRole: { bloc: "allied_mediation" },
      outcomes: [],
      defaultOutcomeId: "stalemate",
    },
  } as unknown as Pick<Crisis, "globalResponse">;

  const ALLIED_SUPPORT = {
    optionId: "allied_support",
    label: "Support the alliance line",
    description: "Contribute money, logistics, and diplomatic backing.",
    effects: [],
    campaignRequirement: {
      allowedStages: ["posture", "mobilization", "operations"],
      minMilitaryReadiness: 42,
      minLogistics: 38,
    },
  } as unknown as CrisisDecisionOption;

  function dbWithNoMilitary(): Db {
    const db = createMockDb();
    ["livingConflicts", "federalBudget", "governmentApprovals", "militaryUnits"].forEach((c) =>
      db.collection(c)
    );
    db.collectionMocks["livingConflicts"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["federalBudget"]!.findOne.mockResolvedValue({
      countryId: "US",
      gdp: 1_000_000_000_000,
      treasuryBalance: 50_000_000_000,
    });
    db.collectionMocks["governmentApprovals"]!.findOne.mockResolvedValue({ approvalRating: 60 });
    return db as unknown as Db;
  }

  it("refuses an option the nation cannot support as a 400 carrying the reasons", async () => {
    const err = await prepareGlobalResponseOption(
      dbWithNoMilitary(),
      CRISIS,
      "US",
      ALLIED_SUPPORT
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toMatch(/military readiness 42/);
  });

  it("returns the capability snapshot when the requirement is met", async () => {
    const capability = await prepareGlobalResponseOption(dbWithNoMilitary(), CRISIS, "US", {
      optionId: "allied_mediation",
      label: "Demand negotiations",
      description: "Press the alliance toward talks.",
      effects: [],
    } as unknown as CrisisDecisionOption);

    expect(capability.domesticSupport).toBe(60);
  });

  it.each(["intervene", "peacekeeping"])(
    "enforces the authored Yugoslavia %s capacity on the command path",
    async (optionId) => {
      const response = YUGOSLAVIA_DEF.phases[0].events[0].response!;
      const option = Object.values(response.decisionTrees)
        .flatMap((tree) => tree.options ?? [])
        .find((candidate) => candidate.optionId === optionId)!;
      const crisis = {
        ...CRISIS,
        globalResponse: { ...CRISIS.globalResponse!, conflictKey: YUGOSLAVIA_DEF.key },
      };
      await expect(
        prepareGlobalResponseOption(dbWithNoMilitary(), crisis, "US", option)
      ).rejects.toMatchObject({ status: 400 });
    }
  );
});

describe("loadCampaignCapability — national logistics", () => {
  it("normalizes the military equipment track to the 0–100 capacity scale", async () => {
    const db = createMockDb();
    ["federalBudget", "governmentApprovals", "militaryUnits"].forEach((name) =>
      db.collection(name)
    );
    db.collectionMocks["federalBudget"]!.findOne.mockResolvedValue({
      countryId: "US",
      gdp: 1_000_000,
      treasuryBalance: -774_000,
    });
    db.collectionMocks["governmentApprovals"]!.findOne.mockResolvedValue({ approvalRating: 48 });
    db.collectionMocks["militaryUnits"]!.find.mockReturnValue(
      createAsyncIterableCursor([
        {
          personnel: 10_000,
          readiness: 67,
          equipment: { support: EQUIPMENT_TRACK_MAX },
        },
      ])
    );

    const result = await loadCampaignCapability(db as unknown as Db, "US");

    expect(result.logistics).toBe(100);
  });
});

describe("concurrent national campaign commitments", () => {
  it.each([true, false])(
    "retains both countries when reads collide (stored campaign: %s)",
    async (hasCampaign) => {
      const db = createMockDb();
      const collection: MockCollection = db.collection("livingConflicts");
      const stored: LivingConflictState = {
        ...emptyConflictState("transnational_terrorism"),
        tracks: { threatCapability: 61 },
        ...(hasCampaign ? { campaign: normalizeCampaignState(undefined) } : {}),
      };
      let reads = 0;
      let release: () => void = () => {};
      const bothRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      collection.findOne.mockImplementation(async () => {
        const snapshot = structuredClone(stored);
        reads++;
        if (reads === 2) release();
        if (reads <= 2) await bothRead;
        return snapshot;
      });
      let collisions = 0;
      collection.updateOne.mockImplementation(
        async (
          filter: { campaign?: { $exists?: boolean } },
          update: { $set: Record<string, unknown> }
        ) => {
          // Model Mongo's atomic equality guard, including the stale first read.
          if (
            filter.campaign &&
            JSON.stringify(filter.campaign) !== JSON.stringify(stored.campaign)
          ) {
            collisions++;
            return { matchedCount: 0, modifiedCount: 0 };
          }
          for (const [path, value] of Object.entries(update.$set)) {
            if (path.startsWith("tracks.")) {
              stored.tracks = { ...stored.tracks, [path.slice(7)]: Number(value) };
            } else {
              Object.assign(stored, { [path]: value });
            }
          }
          return { matchedCount: 1, modifiedCount: 1 };
        }
      );
      const event = {
        ...crisis(),
        livingConflictEventId: "terrorism:concurrent:1",
      };
      if (!event.globalResponse) throw new Error("Missing fixture definition");
      event.globalResponse.conflictKey = "transnational_terrorism";
      const option: CrisisDecisionOption = {
        optionId: "emergency_powers",
        label: "Emergency powers",
        description: "Test response",
        effects: [],
        nextNodeId: null,
        campaignCommitment: {
          kind: "military",
          scale: 12,
          consequences: { civilianStrain: 3 },
        },
      };
      await Promise.all(
        ["US", "UK"].map((country) =>
          recordGlobalResponseCommitment(db as unknown as Db, event, country, 48, option)
        )
      );
      expect(collisions).toBe(1);
      expect(stored.campaign?.countryMemory.US.militaryCommitment).toBe(12);
      expect(stored.campaign?.countryMemory.UK.militaryCommitment).toBe(12);
      expect(stored.campaign?.consequences.civilianStrain).toBe(6);
      expect(stored.tracks).toEqual({
        threatCapability: 61,
        "emergencyPowers:US": 20,
        "emergencyPowers:UK": 20,
      });
      const after = structuredClone(stored);
      const writes = collection.updateOne.mock.calls.length;
      await Promise.all(
        ["US", "UK"].map((country) =>
          recordGlobalResponseCommitment(db as unknown as Db, event, country, 48, option)
        )
      );
      expect(stored).toEqual(after);
      expect(collection.updateOne).toHaveBeenCalledTimes(writes);
      expect(
        collection.updateOne.mock.calls.every(([, update]) =>
          Object.keys(update.$set).every((key) =>
            [
              "campaign",
              "updatedAt",
              "tracks.emergencyPowers:US",
              "tracks.emergencyPowers:UK",
            ].includes(key)
          )
        )
      ).toBe(true);
    }
  );
});
