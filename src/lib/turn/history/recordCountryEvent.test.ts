import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordCountryEvent } from "./recordCountryEvent";

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(async () => ({
    iteration: { type: "Beta", number: 2 },
    startingYear: 2019,
  })),
}));

type Inserted = Record<string, unknown>;

function makeDb(inserted: Inserted[]) {
  return {
    collection: () => ({
      insertOne: async (doc: Inserted) => {
        inserted.push(doc);
      },
    }),
  } as never;
}

describe("recordCountryEvent iteration stamp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stamps current iteration and startingYear", async () => {
    const inserted: Inserted[] = [];
    await recordCountryEvent(makeDb(inserted), {
      countryId: "US",
      turn: 5,
      eventType: "leader_change",
      title: "x",
      officeType: "president",
    });
    expect(inserted[0].iteration).toEqual({ type: "Beta", number: 2 });
    expect(inserted[0].iterationStartingYear).toBe(2019);
  });
});
