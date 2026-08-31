import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CrisisTemplate } from "@/lib/db/types/crisis";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { createCrisisFromTemplate } from "./createCrisisFromTemplate";

const createCrisisInteraction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("./featureFlag", () => ({ isCrisisInteractionEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("./interactionEngine", () => ({ createCrisisInteraction }));
vi.mock("./crisisLocation", () => ({
  resolveCrisisLocationName: vi.fn().mockResolvedValue("Testland"),
  interpolateLocation: (text: string) => text,
}));

const TEMPLATE = {
  name: "Scheduled Crisis",
  description: "A scheduled crisis",
  scope: "country",
  countryIds: [],
  regionIds: [],
  effects: [],
  durationTurns: 12,
  wireMessageOnStart: "It begins",
  wireMessageOnEnd: null,
  interactionDefinition: {
    autoResolveOnExpiry: true,
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Respond",
        description: "Choose a response",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [],
      },
    ],
  },
} as CrisisTemplate;

describe("createCrisisFromTemplate interaction timing", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("crises");
    db.collectionMocks.crises!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  });

  it("creates interactions immediately by default", async () => {
    await createCrisisFromTemplate(db as unknown as Db, {
      template: TEMPLATE,
      scope: "country",
      countryIds: ["US"],
      regionIds: [],
      currentTurn: 438,
    });

    expect(createCrisisInteraction).toHaveBeenCalledTimes(1);
  });

  it("defers a future crisis interaction until crisisTurn reaches its start", async () => {
    await createCrisisFromTemplate(db as unknown as Db, {
      template: TEMPLATE,
      scope: "country",
      countryIds: ["US"],
      regionIds: [],
      currentTurn: 439,
      deferInteractionUntilStart: true,
    });

    expect(createCrisisInteraction).not.toHaveBeenCalled();
  });
});
