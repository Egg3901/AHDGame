import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ isCountryEnabledForPlayers: vi.fn() }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const CONFIG = {
  _id: "default",
  discordGameWebhookUrl: "https://discord.test/global",
  discordCountryGameWebhookUrls: { US: "https://discord.test/us" },
};

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, text: async () => "", json: async () => ({}) });
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({
    collection: () => ({ findOne: async () => CONFIG }),
  } as never);
});

function postedUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

describe("country webhook gating", () => {
  it("posts to both the country and global webhooks when enabled", async () => {
    const { isCountryEnabledForPlayers } = await import("@/lib/countryAccess");
    vi.mocked(isCountryEnabledForPlayers).mockResolvedValue(true);
    const { sendCountryGameEventMultiple } = await import("./discordWebhooks");

    await sendCountryGameEventMultiple("US", [{ color: 1, title: "t" }]);

    expect(postedUrls()).toContain("https://discord.test/us");
    expect(postedUrls()).toContain("https://discord.test/global");
  });

  it("skips the country webhook but still posts globally when disabled", async () => {
    const { isCountryEnabledForPlayers } = await import("@/lib/countryAccess");
    vi.mocked(isCountryEnabledForPlayers).mockResolvedValue(false);
    const { sendCountryGameEventMultiple } = await import("./discordWebhooks");

    await sendCountryGameEventMultiple("US", [{ color: 1, title: "t" }]);

    expect(postedUrls()).not.toContain("https://discord.test/us");
    expect(postedUrls()).toContain("https://discord.test/global");
  });

  it("posts exactly once when the country and global webhooks are the same URL", async () => {
    const { isCountryEnabledForPlayers } = await import("@/lib/countryAccess");
    vi.mocked(isCountryEnabledForPlayers).mockResolvedValue(true);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: async () => ({
          _id: "default",
          discordGameWebhookUrl: "https://discord.test/same",
          discordCountryGameWebhookUrls: { US: "https://discord.test/same" },
        }),
      }),
    } as never);
    const { sendCountryGameEventMultiple } = await import("./discordWebhooks");

    await sendCountryGameEventMultiple("US", [{ color: 1, title: "t" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no longer exports the legacy US/UK helpers", async () => {
    const mod = await import("./discordWebhooks");
    expect("sendUSGameEvent" in mod).toBe(false);
    expect("sendUSGameEventMultiple" in mod).toBe(false);
    expect("sendUKGameEventMultiple" in mod).toBe(false);
  });
});
