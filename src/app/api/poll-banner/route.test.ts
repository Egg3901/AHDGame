import { describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

async function setup(config: Record<string, unknown> | null) {
  vi.clearAllMocks();
  const db: MockDb = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collection("gameConfig");
  db.collectionMocks.gameConfig!.findOne.mockResolvedValue(config);

  const { invalidatePollBannerCache } = await import("@/lib/pollBannerCache");
  invalidatePollBannerCache();
  return db;
}

const ENABLED = {
  _id: "default",
  pollBannerEnabled: true,
  pollBannerMessage: "Please fill out the survey here for feedback about the game:",
  pollBannerLinkLabel: "Click Here",
  pollBannerUrl: "https://forms.gle/abc123",
  pollBannerTone: "warning",
};

describe("GET /api/poll-banner", () => {
  it("returns the configured banner while it is enabled", async () => {
    await setup(ENABLED);
    const { GET } = await import("./route");

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      enabled: true,
      message: "Please fill out the survey here for feedback about the game:",
      linkLabel: "Click Here",
      url: "https://forms.gle/abc123",
      tone: "warning",
    });
  });

  it("withholds the url and message while the banner is disabled", async () => {
    await setup({ ...ENABLED, pollBannerEnabled: false });
    const { GET } = await import("./route");

    const body = await (await GET()).json();

    expect(body.enabled).toBe(false);
    expect(body.url).toBe("");
    expect(body.message).toBe("");
  });

  it("reports disabled when no config document exists", async () => {
    await setup(null);
    const { GET } = await import("./route");

    const body = await (await GET()).json();
    expect(body.enabled).toBe(false);
  });

  it("sends a short cache header so every page view does not hit the database", async () => {
    await setup(ENABLED);
    const { GET } = await import("./route");

    const res = await GET();
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=10");
  });
});
