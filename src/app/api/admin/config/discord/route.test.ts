import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/discord/countryWebhooks", () => ({ getCountryWebhookDescriptors: vi.fn() }));

const updateOne = vi.fn();
const findOne = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  updateOne.mockResolvedValue({ acknowledged: true });
  findOne.mockResolvedValue({
    _id: "default",
    discordGameWebhookUrl: "https://discord.test/game",
  });
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({ collection: () => ({ updateOne, findOne }) } as never);
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, user: { username: "admin" } } as never);
  const { getCountryWebhookDescriptors } = await import("@/lib/discord/countryWebhooks");
  vi.mocked(getCountryWebhookDescriptors).mockResolvedValue([
    {
      countryId: "US",
      name: "United States",
      flagEmoji: "🇺🇸",
      url: "https://discord.test/us",
      electionTypes: [{ id: "president", label: "President" }],
    },
    { countryId: "JP", name: "Japan", flagEmoji: "🇯🇵", url: "", electionTypes: [] },
  ] as never);
});

function patchReq(body: unknown) {
  return new Request("http://localhost/api/admin/config/discord", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The update document passed to updateOne in the most recent PATCH call. */
function capturedUpdate() {
  return updateOne.mock.calls.at(-1)?.[1] as
    { $set?: Record<string, unknown>; $unset?: Record<string, unknown> } | undefined;
}

describe("GET /api/admin/config/discord", () => {
  it("returns general urls plus country descriptors", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();

    expect(body.general.game).toBe("https://discord.test/game");
    expect(body.countries).toHaveLength(2);
    expect(body.countries[0].countryId).toBe("US");
    expect(body.countries[0].url).toBe("https://discord.test/us");
  });

  it("defaults missing general urls to empty strings", async () => {
    findOne.mockResolvedValue({ _id: "default" });
    const { GET } = await import("./route");
    const body = await (await GET()).json();

    expect(body.general).toEqual({ game: "", news: "", suggestions: "", changelog: "" });
  });
});

describe("PATCH /api/admin/config/discord", () => {
  it("writes country urls into the country map, never a top-level field", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ countryWebhooks: { US: "https://discord.test/us" } }));

    expect(res.status).toBe(200);
    expect(capturedUpdate()?.$set).toMatchObject({
      "discordCountryGameWebhookUrls.US": "https://discord.test/us",
    });
    expect(capturedUpdate()?.$set).not.toHaveProperty("discordUSGameWebhookUrl");
  });

  it("routes several countries into the map in one call", async () => {
    const { PATCH } = await import("./route");
    await PATCH(
      patchReq({
        countryWebhooks: { US: "https://discord.test/us", JP: "https://discord.test/jp" },
      })
    );

    expect(capturedUpdate()?.$set).toMatchObject({
      "discordCountryGameWebhookUrls.US": "https://discord.test/us",
      "discordCountryGameWebhookUrls.JP": "https://discord.test/jp",
    });
  });

  it("unsets a country entry when given an empty string", async () => {
    const { PATCH } = await import("./route");
    await PATCH(patchReq({ countryWebhooks: { US: "", JP: "" } }));

    expect(capturedUpdate()?.$unset).toMatchObject({
      "discordCountryGameWebhookUrls.US": 1,
      "discordCountryGameWebhookUrls.JP": 1,
    });
  });

  it("rejects a country that is not player-enabled", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ countryWebhooks: { BR: "https://discord.test/br" } }));

    expect(res.status).toBe(400);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("writes general webhook fields at the top level", async () => {
    const { PATCH } = await import("./route");
    await PATCH(
      patchReq({
        general: { news: "https://discord.test/news", changelog: "https://discord.test/log" },
      })
    );

    expect(capturedUpdate()?.$set).toMatchObject({
      discordNewsWebhookUrl: "https://discord.test/news",
      discordChangelogWebhookUrl: "https://discord.test/log",
    });
  });

  it("unsets a general field when given an empty string", async () => {
    const { PATCH } = await import("./route");
    await PATCH(patchReq({ general: { news: "" } }));

    expect(capturedUpdate()?.$unset).toMatchObject({ discordNewsWebhookUrl: 1 });
  });

  it("rejects a malformed url", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ countryWebhooks: { US: "not-a-url" } }));

    expect(res.status).toBe(400);
    expect(updateOne).not.toHaveBeenCalled();
  });
});

/**
 * #1208: the webhook URLs live in `gameConfig`, so a database restore carries
 * them into another deployment. Saving them records which deployment owns them,
 * which is what `discordWebhooks` checks before every send.
 */
describe("PATCH /api/admin/config/discord — webhook ownership stamp (#1208)", () => {
  const originalService = process.env.RAILWAY_SERVICE_NAME;

  afterEach(() => {
    process.env.RAILWAY_SERVICE_NAME = originalService;
  });

  it("stamps the running deployment when a webhook url is saved", async () => {
    process.env.RAILWAY_SERVICE_NAME = "Main Site";
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ general: { news: "https://discord.test/news" } }));

    expect(res.status).toBe(200);
    expect(capturedUpdate()?.$set).toMatchObject({
      discordNewsWebhookUrl: "https://discord.test/news",
      discordWebhookOwnerService: "main-site",
    });
  });

  it("stamps when a country webhook is saved too", async () => {
    process.env.RAILWAY_SERVICE_NAME = "Main Site";
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ countryWebhooks: { US: "https://discord.test/us2" } }));

    expect(res.status).toBe(200);
    expect(capturedUpdate()?.$set).toMatchObject({
      "discordCountryGameWebhookUrls.US": "https://discord.test/us2",
      discordWebhookOwnerService: "main-site",
    });
  });

  /**
   * Without this, the guard undoes itself: an admin poking at the Discord page
   * of a restored world silently moves ownership to that deployment, and it
   * resumes posting to the live channels it inherited.
   */
  it("refuses to take ownership from another deployment", async () => {
    process.env.RAILWAY_SERVICE_NAME = "Sandbox Staging";
    findOne.mockResolvedValue({ _id: "default", discordWebhookOwnerService: "main-site" });
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ general: { news: "https://discord.test/news" } }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: expect.stringContaining("main-site"),
    });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("transfers ownership only when the caller asks for it explicitly", async () => {
    process.env.RAILWAY_SERVICE_NAME = "Sandbox Staging";
    findOne.mockResolvedValue({ _id: "default", discordWebhookOwnerService: "main-site" });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      patchReq({ general: { news: "https://discord.test/news" }, claimWebhooks: true })
    );

    expect(res.status).toBe(200);
    expect(capturedUpdate()?.$set).toMatchObject({
      discordWebhookOwnerService: "sandbox-staging",
    });
  });

  it("lets the owning deployment save without claiming anything", async () => {
    process.env.RAILWAY_SERVICE_NAME = "Main Site";
    findOne.mockResolvedValue({ _id: "default", discordWebhookOwnerService: "main-site" });
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ general: { news: "https://discord.test/news" } }));

    expect(res.status).toBe(200);
    expect(capturedUpdate()?.$set).toMatchObject({ discordWebhookOwnerService: "main-site" });
  });

  it("does not stamp when every url in the request is being cleared", async () => {
    process.env.RAILWAY_SERVICE_NAME = "Main Site";
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ general: { news: "" } }));

    expect(res.status).toBe(200);
    expect(capturedUpdate()?.$unset).toMatchObject({ discordNewsWebhookUrl: 1 });
    expect(capturedUpdate()?.$set?.discordWebhookOwnerService).toBeUndefined();
  });
});
