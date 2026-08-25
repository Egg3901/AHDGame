import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { CrisisTemplate } from "@/lib/db/types/crisis";
import { createCrisisFromTemplate } from "./createCrisisFromTemplate";

vi.mock("./featureFlag", () => ({ isCrisisInteractionEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("./crisisLocation", () => ({
  resolveCrisisLocationName: vi.fn().mockResolvedValue("Testland"),
  interpolateLocation: (text: string) => text,
}));

const TEMPLATE = {
  name: "Test Crisis",
  description: "A crisis in {location}",
  heroImage: "test.png",
  effects: [],
  wireMessageOnStart: "It begins",
  wireMessageOnEnd: null,
  durationTurns: 8,
} as unknown as CrisisTemplate;

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  db.collection("crises");
  db.collectionMocks.crises!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
});

function insertedDoc(): Record<string, unknown> {
  return db.collectionMocks.crises!.insertOne.mock.calls[0][0] as Record<string, unknown>;
}

describe("createCrisisFromTemplate livingConflictEventId key", () => {
  it("omits the field entirely when neither params nor template carry an id", async () => {
    await createCrisisFromTemplate(db as unknown as Db, {
      template: TEMPLATE,
      scope: "country",
      countryIds: ["US"],
      regionIds: [],
      currentTurn: 100,
    });
    // Key absence is the contract: an explicit undefined would be serialized
    // as null by the driver and collide in the crises_living_event unique
    // index (E11000 on { livingConflictEventId: null }, GlitchTip AHD-1JV).
    expect("livingConflictEventId" in insertedDoc()).toBe(false);
  });

  it("writes the param id when provided", async () => {
    await createCrisisFromTemplate(db as unknown as Db, {
      template: TEMPLATE,
      scope: "country",
      countryIds: ["US"],
      regionIds: [],
      currentTurn: 100,
      livingConflictEventId: "vietnam:escalation:3",
    });
    expect(insertedDoc().livingConflictEventId).toBe("vietnam:escalation:3");
  });

  it("falls back to the template id when the param is absent", async () => {
    await createCrisisFromTemplate(db as unknown as Db, {
      template: { ...TEMPLATE, livingConflictEventId: "template:event:1" } as CrisisTemplate,
      scope: "country",
      countryIds: ["US"],
      regionIds: [],
      currentTurn: 100,
    });
    expect(insertedDoc().livingConflictEventId).toBe("template:event:1");
  });
});
