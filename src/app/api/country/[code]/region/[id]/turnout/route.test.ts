import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/collections", () => ({
  getStateDemographicTurnoutCollection: vi.fn(),
}));

// The non-US branch resolves the country's era from the world's seed preset.
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn(async () => "2019-default"),
}));

async function setTurnoutDoc(doc: unknown) {
  const { getStateDemographicTurnoutCollection } = await import("@/lib/db/collections");
  vi.mocked(getStateDemographicTurnoutCollection).mockResolvedValue({
    findOne: vi.fn().mockResolvedValue(doc),
  } as never);
}

function req() {
  return new Request("http://localhost/turnout");
}

describe("GET region turnout: country-aware census buckets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns JP's own census buckets (not US Layer-1) for a JP region", async () => {
    await setTurnoutDoc({
      _id: "JP-13",
      modifiers: { age: { senior: 3 } },
      lastUpdated: null,
      lastDecayApplied: null,
    });

    const { GET } = await import("./route");
    const res = await GET(req() as never, {
      params: Promise.resolve({ code: "JP", id: "JP-13" }),
    });
    const body = await res.json();

    expect(body.turnout.urbanization).toBeDefined();
    expect(body.turnout.race).toBeUndefined();
    expect(body.turnout.jp_voterGroups).toBeUndefined();
    // JP model baseline 72 for age:senior + modifier 3
    expect(body.turnout.age.senior).toEqual({ baseline: 72, modifier: 3, actual: 75 });
  });

  it("returns IE's own census buckets for an IE region", async () => {
    await setTurnoutDoc({ _id: "IE-DUB", modifiers: {} });

    const { GET } = await import("./route");
    const res = await GET(req() as never, {
      params: Promise.resolve({ code: "IE", id: "IE-DUB" }),
    });
    const body = await res.json();

    expect(body.turnout.education).toBeDefined();
    expect(body.turnout.ie_voterGroups).toBeUndefined();
  });

  it("still returns US Layer-1 categories for a US region (regression)", async () => {
    await setTurnoutDoc({ _id: "CA", modifiers: { race: { white: 2 } } });

    const { GET } = await import("./route");
    const res = await GET(req() as never, {
      params: Promise.resolve({ code: "US", id: "CA" }),
    });
    const body = await res.json();

    expect(body.turnout.race).toBeDefined();
    expect(body.turnout.wealth).toBeDefined();
    expect(body.turnout.urbanization).toBeUndefined();
  });
});
