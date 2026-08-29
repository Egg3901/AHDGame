import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInsertOne = vi.fn();
let mockGameConfig: Record<string, unknown> = { discordNewsWebhookUrl: "http://hook/news" };
const mockGetDb = vi.fn(async () => ({
  collection: (name: string) => {
    if (name === "gameConfig") {
      return { findOne: async () => mockGameConfig };
    }
    // sentNewsDedup
    return {
      createIndex: async () => undefined,
      insertOne: (...args: unknown[]) => mockInsertOne(...args),
    };
  },
}));
vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/countryAccess", () => ({ isCountryEnabledForPlayers: async () => true }));

import { buildBillVetoedDiscordEmbed, DISCORD_COLORS, sendNewsEvent } from "./discordWebhooks";

describe("sendNewsEvent dedup (#1208)", () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: "1" }),
    text: async () => "",
  }));
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    mockGameConfig = { discordNewsWebhookUrl: "http://hook/news" };
  });

  const embed = {
    title: "First Secretary of State Established",
    description: "The office was established.",
    color: 1,
  };

  it("posts a news embed the first time (dedup claim succeeds)", async () => {
    mockInsertOne.mockResolvedValueOnce({});
    await sendNewsEvent(embed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("suppresses a duplicate embed when the claim hits a duplicate key", async () => {
    mockInsertOne.mockRejectedValueOnce({ code: 11000 });
    await sendNewsEvent(embed);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still posts if the dedup store errors (never silences real news)", async () => {
    mockInsertOne.mockRejectedValueOnce(new Error("db down"));
    await sendNewsEvent(embed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * #1208: World News carried a "First Secretary of State Established" embed for a
 * world that had not reached the office's year. It never existed in the live
 * database — the webhook URLs live in `gameConfig`, so a RESTORE of the
 * production database into another deployment (sandbox, staging, a dev server)
 * inherits the live webhook and posts its own world's events into the players'
 * channel.
 */
describe("webhook deployment guard (#1208)", () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: "1" }),
    text: async () => "",
  }));
  const originalService = process.env.RAILWAY_SERVICE_NAME;
  const originalEnvName = process.env.RAILWAY_ENVIRONMENT_NAME;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    mockInsertOne.mockResolvedValue({});
    delete process.env.RAILWAY_SERVICE_NAME;
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
  });

  afterEach(() => {
    process.env.RAILWAY_SERVICE_NAME = originalService;
    process.env.RAILWAY_ENVIRONMENT_NAME = originalEnvName;
  });

  const embed = { title: "T", description: "D", color: 1 };

  it("posts when the running service owns the configured webhooks", async () => {
    process.env.RAILWAY_SERVICE_NAME = "Main Site";
    mockGameConfig = {
      discordNewsWebhookUrl: "http://hook/news",
      discordWebhookOwnerService: "main-site",
    };
    await sendNewsEvent(embed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("suppresses the send when another deployment owns the webhooks", async () => {
    process.env.RAILWAY_SERVICE_NAME = "Sandbox Staging";
    mockGameConfig = {
      discordNewsWebhookUrl: "http://hook/news",
      discordWebhookOwnerService: "main-site",
    };
    await sendNewsEvent(embed);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suppresses a restored database run outside Railway entirely (local dev cron)", async () => {
    mockGameConfig = {
      discordNewsWebhookUrl: "http://hook/news",
      discordWebhookOwnerService: "main-site",
    };
    await sendNewsEvent(embed);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts when no owner is stamped, so an existing world is never silenced", async () => {
    process.env.RAILWAY_SERVICE_NAME = "Anything At All";
    mockGameConfig = { discordNewsWebhookUrl: "http://hook/news" };
    await sendNewsEvent(embed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("buildBillVetoedDiscordEmbed", () => {
  const billUrl = "https://ahousedividedgame.com/congress/bills/abc123";

  it("names the bill and the vetoing president in the description", () => {
    const embed = buildBillVetoedDiscordEmbed({
      billTitle: "Clean Air Act",
      presidentName: "Jane Doe",
      billUrl,
    });

    expect(embed.title).toBe("USA — Bill Vetoed — Federal");
    expect(embed.description).toContain("Clean Air Act");
    expect(embed.description).toContain("President Jane Doe");
    expect(embed.color).toBe(DISCORD_COLORS.billVetoed);
    expect(embed.url).toBe(billUrl);
  });

  it("falls back to 'the President' when no name is supplied", () => {
    const embed = buildBillVetoedDiscordEmbed({
      billTitle: "Budget Bill",
      billUrl,
    });

    expect(embed.description).toContain("the President");
    expect(embed.description).not.toContain("President undefined");
  });

  it("includes a View Bill link field pointing at the bill", () => {
    const embed = buildBillVetoedDiscordEmbed({ billTitle: "Tax Bill", billUrl });

    const viewField = embed.fields?.find((f) => f.name === "View Bill");
    expect(viewField).toBeDefined();
    expect(viewField?.value).toContain(billUrl);
  });

  it("adds a Veto Message field only when a message is provided", () => {
    const withMsg = buildBillVetoedDiscordEmbed({
      billTitle: "Tax Bill",
      billUrl,
      vetoMessage: "This bill is fiscally irresponsible.",
    });
    const withoutMsg = buildBillVetoedDiscordEmbed({ billTitle: "Tax Bill", billUrl });

    const msgField = withMsg.fields?.find((f) => f.name === "Veto Message");
    expect(msgField?.value).toBe("This bill is fiscally irresponsible.");
    expect(withoutMsg.fields?.some((f) => f.name === "Veto Message")).toBe(false);
  });
});
