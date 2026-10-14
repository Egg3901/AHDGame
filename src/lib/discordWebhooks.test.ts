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
const mockCardUrl = vi.hoisted(() => ({ value: undefined as string | null | undefined }));
vi.mock("@/lib/discord/eventCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discord/eventCard")>();
  return {
    ...actual,
    generateDiscordEventCard: async (
      ...args: Parameters<typeof actual.generateDiscordEventCard>
    ) =>
      mockCardUrl.value !== undefined
        ? mockCardUrl.value
        : actual.generateDiscordEventCard(...args),
  };
});

import {
  buildBillVetoedDiscordEmbed,
  DISCORD_COLORS,
  notifyNewSuggestionDiscord,
  sendDiscordWebhookMultiple,
  sendNewsEvent,
  suggestionEventCardInput,
} from "./discordWebhooks";

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

  it("carries the chamber vote split for the card but strips it before posting", async () => {
    const embed = buildBillVetoedDiscordEmbed({
      billTitle: "Tax Bill",
      billUrl,
      voteSplit: [{ label: "House", votesFor: 220, votesAgainst: 210, votesAbstain: 5 }],
    });
    expect(embed.cardVoteSplit).toHaveLength(1);

    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    await sendDiscordWebhookMultiple("http://hook/game", [embed]);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const body = call[1].body;
    expect(body).not.toContain("cardVoteSplit");
    expect(body).toContain("Tax Bill");
  });
});

describe("player suggestion branded card", () => {
  const input = {
    issueNumber: 371,
    category: "ui_improvement",
    title: "Party Organization, well...organization",
    description: "See every party's organization values in one view.",
    impact: "Less clicking.",
    reporterUsername: "player",
    reporterDiscordUsername: "player",
    detailUrl: "https://ahousedividedgame.com/feedback/371",
    gameSystem: "parties",
  };

  it("builds card copy with humanized chips and the reporter", () => {
    const card = suggestionEventCardInput(input);
    expect(card.eyebrow).toBe("Player suggestion · S#371");
    expect(card.title).toBe(input.title);
    expect(card.metadata).toEqual(["UI improvement", "Parties"]);
    expect(card.detailLines).toEqual(["Suggested by @player"]);
    expect(card.tone).toBe("suggestion");
  });

  it("falls back to the plain embed when the card has no fetchable URL", async () => {
    mockGameConfig = { discordSuggestionsWebhookUrl: "http://hook/suggestions" };
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "msg-1" }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    // Local-disk card storage returns a relative path Discord cannot fetch.
    mockCardUrl.value = "/api/uploads/charts/event-suggestion-371.png";
    const result = await notifyNewSuggestionDiscord(input);
    expect(result).toEqual({ status: "posted", messageId: "msg-1" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.embeds[0].image).toBeUndefined();
    expect(body.embeds[0].fields.map((f: { name: string }) => f.name)).toContain("Category");
  });

  it("posts the card image and drops the fields the card already shows", async () => {
    mockGameConfig = { discordSuggestionsWebhookUrl: "http://hook/suggestions" };
    mockCardUrl.value = "https://cdn.example/charts/event-suggestion-371.png";
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "msg-2" }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await notifyNewSuggestionDiscord(input);
    expect(result.status).toBe("posted");
    const embed = JSON.parse(fetchMock.mock.calls[0]![1].body).embeds[0];
    expect(embed.image).toEqual({ url: "https://cdn.example/charts/event-suggestion-371.png" });
    expect(embed.description).toContain(input.description);
    expect(embed.fields.map((f: { name: string }) => f.name)).toEqual(["Expected impact"]);
    mockCardUrl.value = undefined;
  });
});
