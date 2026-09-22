import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createFakeLeadershipDb } from "@/lib/uk/leadership/leadershipTestDb";
import { getUKPartyConferencesCollection } from "@/lib/db/collections/ukPartyConferences";
import { conferenceDocId } from "@/lib/uk/conference/conferenceStore";
import { pledgeCatalogFor } from "@/lib/uk/manifesto/pledgeCatalog";
import type { PoliticalParty } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn(async () => undefined) }));

import { GET as getConference } from "./route";
import { POST as postSchedule } from "./schedule/route";
import { POST as postPlatform } from "./platform/route";
import { POST as postPlatformVote } from "./platform/vote/route";
import { POST as postMotion } from "./motions/route";
import { POST as postMotionVote } from "./motions/vote/route";

const NOW = new Date("2026-09-17T00:00:00Z");
const LEADER_ID = new ObjectId();
const MEMBER_ID = new ObjectId();

let db: Db;

async function seedUkParty() {
  await db.collection("characters").insertOne({
    _id: LEADER_ID,
    name: "Leader Lex",
    party: "2",
    countryId: "UK",
    userId: new ObjectId(),
  });
  await db.collection("characters").insertOne({
    _id: MEMBER_ID,
    name: "Member Mia",
    party: "2",
    countryId: "UK",
    userId: new ObjectId(),
  });
  const party = {
    _id: new ObjectId(),
    sequentialId: 2,
    countryId: "UK",
    name: "Conservative Party",
    abbreviation: "CON",
    chairId: LEADER_ID,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    isDefault: true,
    politicalStrength: 0,
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as PoliticalParty;
  await db.collection("politicalParties").insertOne({ ...party });
}

const UK_PARAMS = { params: Promise.resolve({ code: "uk", id: "2" }) };

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authAs(character: Record<string, unknown>) {
  return {
    ok: true as const,
    user: {
      userId: "user-1",
      isBanned: false,
      character: { _id: LEADER_ID, name: "Leader Lex", party: "2", countryId: "UK", ...character },
    },
  };
}

async function setupMocks(opts: { turn?: number; character?: Record<string, unknown> } = {}) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue(authAs(opts.character ?? {}) as never);
  const { getGameTime } = await import("@/lib/time/gameTime");
  vi.mocked(getGameTime).mockResolvedValue({
    currentTurn: opts.turn ?? 2,
    effectiveNow: NOW,
  } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createFakeLeadershipDb();
  await seedUkParty();
  await setupMocks();
});

describe("GET conference state", () => {
  it("returns this year's conference view with capabilities", async () => {
    const res = await getConference(new Request("http://localhost/api"), UK_PARAMS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.conferenceId).toBe(conferenceDocId("UK", "2", 1));
    expect(body.status).toBe("scheduled");
    expect(body).toHaveProperty("catalog");
    expect(body).toHaveProperty("capabilities");
  });

  it("is a UK-only mechanic: non-UK and unknown countries 400", async () => {
    const us = await getConference(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "2" }),
    });
    expect(us.status).toBe(400);
    const bad = await getConference(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "xx", id: "2" }),
    });
    expect(bad.status).toBe(400);
  });

  it("requires a character (401 when unauthenticated)", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "nope" }), { status: 401 }),
    } as never);
    const res = await getConference(new Request("http://localhost/api"), UK_PARAMS);
    expect(res.status).toBe(401);
  });
});

describe("POST schedule / platform / platform vote", () => {
  it("schedules, proposes, and votes through the HTTP layer", async () => {
    const scheduled = await postSchedule(
      new Request("http://localhost/api", { method: "POST" }),
      UK_PARAMS
    );
    expect(scheduled.status).toBe(200);

    // Flip the seeded row open (the turn driver owns opening in production).
    await getUKPartyConferencesCollection(db).updateOne(
      { _id: conferenceDocId("UK", "2", 1) },
      { $set: { status: "open", openedAtTurn: 2 } }
    );

    const ids = pledgeCatalogFor("UK")
      .slice(0, 3)
      .map((e) => e.id);
    const proposed = await postPlatform(jsonRequest({ pledgeIds: ids }), UK_PARAMS);
    expect(proposed.status).toBe(200);

    await setupMocks({ character: { _id: MEMBER_ID, name: "Member Mia" } });
    const voted = await postPlatformVote(jsonRequest({ vote: "aye" }), UK_PARAMS);
    expect(voted.status).toBe(200);
    expect(await voted.json()).toMatchObject({ success: true, votesFor: 1 });
  });

  it("validates bodies with zod and pledge shape with the catalog", async () => {
    const missing = await postPlatform(jsonRequest({}), UK_PARAMS);
    expect(missing.status).toBe(400);
    const badVote = await postPlatformVote(jsonRequest({ vote: "maybe" }), UK_PARAMS);
    expect(badVote.status).toBe(400);
  });

  it("rejects non-members at the route gate", async () => {
    await setupMocks({
      character: { _id: new ObjectId(), name: "Stranger", party: "99", countryId: "UK" },
    });
    const res = await postSchedule(
      new Request("http://localhost/api", { method: "POST" }),
      UK_PARAMS
    );
    expect(res.status).toBe(403);
  });

  it("rejects every writer on non-UK countries", async () => {
    const usParams = { params: Promise.resolve({ code: "us", id: "2" }) };
    expect(
      (await postSchedule(new Request("http://localhost/api", { method: "POST" }), usParams)).status
    ).toBe(400);
    expect((await postPlatform(jsonRequest({ pledgeIds: ["a"] }), usParams)).status).toBe(400);
    expect((await postPlatformVote(jsonRequest({ vote: "aye" }), usParams)).status).toBe(400);
  });
});

describe("POST motions / motions vote", () => {
  async function openWithProposal() {
    await postSchedule(new Request("http://localhost/api", { method: "POST" }), UK_PARAMS);
    await getUKPartyConferencesCollection(db).updateOne(
      { _id: conferenceDocId("UK", "2", 1) },
      { $set: { status: "open", openedAtTurn: 2 } }
    );
  }

  it("proposes and votes a committee motion through the HTTP layer", async () => {
    // The leader sits in the committee electorate, so leader auth suffices.
    await openWithProposal();
    const proposed = await postMotion(jsonRequest({ triggerThresholdPct: 0.2 }), UK_PARAMS);
    expect(proposed.status).toBe(200);
    const { motionId } = (await proposed.json()) as { motionId: string };
    expect(typeof motionId).toBe("string");

    const voted = await postMotionVote(jsonRequest({ motionId, vote: "aye" }), UK_PARAMS);
    expect(voted.status).toBe(200);
    expect(await voted.json()).toMatchObject({ success: true, votesFor: 1 });
  });

  it("rejects empty patches and unknown motion ids", async () => {
    await openWithProposal();
    expect((await postMotion(jsonRequest({}), UK_PARAMS)).status).toBe(400);
    expect(
      (await postMotionVote(jsonRequest({ motionId: "nope", vote: "aye" }), UK_PARAMS)).status
    ).toBe(400);
  });

  it("rejects motion writers on non-UK countries", async () => {
    const usParams = { params: Promise.resolve({ code: "us", id: "2" }) };
    expect((await postMotion(jsonRequest({ triggerThresholdPct: 0.2 }), usParams)).status).toBe(
      400
    );
    expect(
      (await postMotionVote(jsonRequest({ motionId: "x", vote: "aye" }), usParams)).status
    ).toBe(400);
  });
});
