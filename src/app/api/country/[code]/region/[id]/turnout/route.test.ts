import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/collections", () => ({
  getStateDemographicTurnoutCollection: vi.fn(),
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

describe("GET region turnout — country-aware voter groups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the JP voter-group bucket (not US Layer-1) for a JP region", async () => {
    await setTurnoutDoc({
      _id: "JP-13",
      modifiers: { jp_voterGroups: { komeito_faithful: 3 } },
      lastUpdated: null,
      lastDecayApplied: null,
    });

    const { GET } = await import("./route");
    const res = await GET(req() as never, {
      params: Promise.resolve({ code: "JP", id: "JP-13" }),
    });
    const body = await res.json();

    expect(body.turnout.jp_voterGroups).toBeDefined();
    expect(body.turnout.race).toBeUndefined();
    // baseline 72 (komeito seed) + modifier 3
    expect(body.turnout.jp_voterGroups.komeito_faithful).toEqual({
      baseline: 72,
      modifier: 3,
      actual: 75,
    });
  });

  it("returns the IE voter-group bucket for an IE region", async () => {
    await setTurnoutDoc({ _id: "IE-DUB", modifiers: { ie_voterGroups: {} } });

    const { GET } = await import("./route");
    const res = await GET(req() as never, {
      params: Promise.resolve({ code: "IE", id: "IE-DUB" }),
    });
    const body = await res.json();

    expect(body.turnout.ie_voterGroups).toBeDefined();
    expect(body.turnout.uk_voterGroups).toBeUndefined();
  });

  it("still returns US Layer-1 categories for a US region (regression)", async () => {
    await setTurnoutDoc({ _id: "CA", modifiers: { race: { white: 2 } } });

    const { GET } = await import("./route");
    const res = await GET(req() as never, {
      params: Promise.resolve({ code: "US", id: "CA" }),
    });
    const body = await res.json();

    expect(body.turnout.race).toBeDefined();
    expect(body.turnout.jp_voterGroups).toBeUndefined();
  });
});
