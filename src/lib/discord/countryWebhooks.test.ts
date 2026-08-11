import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCountryWebhookDescriptors } from "./countryWebhooks";

vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIdsFromDb: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("gameConfig");
  db.collection("gameState");
  db.collectionMocks.gameState!.findOne.mockResolvedValue(null);
});

/** Set the live preset the resolver reads when no preset argument is passed. */
function mockLivePreset(preset: string | undefined) {
  db.collectionMocks.gameState!.findOne.mockResolvedValue(
    preset === undefined ? null : { _id: "current", preset }
  );
}

async function mockEnabled(ids: string[]) {
  const { getEnabledCountryIdsFromDb } = await import("@/lib/countryAccess");
  vi.mocked(getEnabledCountryIdsFromDb).mockResolvedValue(ids as never);
}

function mockUrls(map: Record<string, string> | undefined) {
  db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
    _id: "default",
    discordCountryGameWebhookUrls: map,
  });
}

describe("getCountryWebhookDescriptors", () => {
  it("returns only player-enabled countries", async () => {
    await mockEnabled(["US", "UK"]);
    mockUrls({ US: "https://discord.test/us" });

    const out = await getCountryWebhookDescriptors(db as unknown as Db, "2019-default");

    expect(out.map((d) => d.countryId)).toEqual(["US", "UK"]);
  });

  it("orders results by COUNTRY_ORDER regardless of input order", async () => {
    await mockEnabled(["CN", "US", "DE"]);
    mockUrls({});

    const out = await getCountryWebhookDescriptors(db as unknown as Db, "2019-default");

    expect(out.map((d) => d.countryId)).toEqual(["US", "DE", "CN"]);
  });

  it("returns an empty-string url for an unconfigured country", async () => {
    await mockEnabled(["US"]);
    mockUrls({});

    const [us] = await getCountryWebhookDescriptors(db as unknown as Db, "2019-default");

    expect(us.url).toBe("");
  });

  it("carries the configured url through", async () => {
    await mockEnabled(["US"]);
    mockUrls({ US: "https://discord.test/us" });

    const [us] = await getCountryWebhookDescriptors(db as unknown as Db, "2019-default");

    expect(us.url).toBe("https://discord.test/us");
  });

  it("includes name, flag, note and derived election types", async () => {
    await mockEnabled(["DE"]);
    mockUrls({});

    const [de] = await getCountryWebhookDescriptors(db as unknown as Db, "2019-default");

    expect(de.name).toBe("Germany");
    expect(de.flagEmoji.length).toBeGreaterThan(0);
    expect(de.note).toContain("ECB");
    expect(de.electionTypes.map((t) => t.id)).toEqual([
      "bundestag",
      "landtag",
      "ministerPresident",
    ]);
  });

  it("omits note for countries without one", async () => {
    await mockEnabled(["US"]);
    mockUrls({});

    const [us] = await getCountryWebhookDescriptors(db as unknown as Db, "2019-default");

    expect(us.note).toBeUndefined();
  });

  it("threads the preset into election-type derivation", async () => {
    await mockEnabled(["FR"]);
    mockUrls({});

    const [fr2019] = await getCountryWebhookDescriptors(db as unknown as Db, "2019-default");
    const [fr1953] = await getCountryWebhookDescriptors(db as unknown as Db, "1953-default");

    expect(fr2019.electionTypes.map((t) => t.id)).toContain("president");
    expect(fr1953.electionTypes.map((t) => t.id)).not.toContain("president");
  });

  it("defaults to the live gameState preset when none is passed", async () => {
    await mockEnabled(["FR"]);
    mockUrls({});
    mockLivePreset("1953-default");

    // No preset argument — must pick up 1953 from gameState, not 2019.
    const [fr] = await getCountryWebhookDescriptors(db as unknown as Db);

    expect(fr.electionTypes.map((t) => t.id)).not.toContain("president");
    expect(fr.electionTypes.map((t) => t.id)).toEqual(["senator", "deputy"]);
  });

  it("falls back to 2019-default when gameState has no preset", async () => {
    await mockEnabled(["FR"]);
    mockUrls({});
    mockLivePreset(undefined);

    const [fr] = await getCountryWebhookDescriptors(db as unknown as Db);

    expect(fr.electionTypes.map((t) => t.id)).toContain("president");
  });

  it("an explicit preset argument overrides the live gameState preset", async () => {
    await mockEnabled(["FR"]);
    mockUrls({});
    mockLivePreset("1953-default");

    const [fr] = await getCountryWebhookDescriptors(db as unknown as Db, "2019-default");

    expect(fr.electionTypes.map((t) => t.id)).toContain("president");
  });

  it("tolerates a missing gameConfig document", async () => {
    await mockEnabled(["US"]);
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue(null);

    const out = await getCountryWebhookDescriptors(db as unknown as Db, "2019-default");

    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("");
  });
});
