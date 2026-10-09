/** Casino routes end to end on a real Mongo, with the payloads the Discord bot sends. */
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let db: Db;
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(async () => db) }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn(async () => "applied") }));

import { MAX_STAKE_SHARE } from "@/lib/casino/house";
import { POST as play } from "./play/route";
import { POST as highlow } from "./highlow/route";
import { GET as house } from "./house/route";
import { GET as listRounds, POST as createRound } from "./rounds/route";
import { POST as roundAction } from "./rounds/[id]/route";
import { POST as placeWager } from "../blackjack/place-wager/route";
import { POST as resolveHand } from "../blackjack/resolve/route";

const uri = process.env.FEDERATION_TEST_MONGO_URI;

function post(body: unknown): Request {
  return new Request("http://test/api", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe.skipIf(!uri)("Discord casino routes on isolated Mongo", () => {
  let client: MongoClient;
  let characterId: ObjectId;

  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Isolated loopback Mongo required");
    client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  });
  afterAll(async () => {
    await db?.dropDatabase();
    await client?.close();
  });

  beforeEach(async () => {
    if (db) await db.dropDatabase();
    db = client.db(`ahd_test_casino_routes_${new ObjectId()}`);
    await db
      .collection("gameState")
      .insertOne({ _id: "current" as unknown as ObjectId, preset: "1991-default" });
    await db
      .collection("exchangeRates")
      .insertOne({ _id: "US" as unknown as ObjectId, currencyCode: "USD", rate: 1 });
    const userId = new ObjectId();
    characterId = new ObjectId();
    await db.collection("users").insertOne({ _id: userId, discordId: "p1", isBanned: false });
    await db.collection("characters").insertOne({
      _id: characterId,
      userId,
      name: "Player One",
      countryId: "US",
      currencyBalances: { personal: { USD: 10_000_000 } },
    });
  });

  const cash = async () =>
    (await db.collection("characters").findOne({ _id: characterId }))?.currencyBalances.personal
      .USD;

  it("plays every instant game and keeps the books balanced", async () => {
    const bodies = [
      { game: "slots", discordId: "p1", stake: 1000 },
      { game: "roulette", discordId: "p1", stake: 1000, bet: "straight", number: 17 },
      { game: "crash", discordId: "p1", stake: 1000, target: 2.5 },
      { game: "craps", discordId: "p1", stake: 1000, bet: "dontpass" },
    ];
    let net = 0;
    for (const body of bodies) {
      const res = await play(post(body));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({ game: body.game, stake: 1000, currency: "USD" });
      expect(json.net).toBe(json.payout - 1000);
      net += json.net;
    }
    expect(await cash()).toBe(10_000_000 + net);
    const h = await (
      await house(new Request("http://test/api/discord-bot/casino/house?discordId=p1"))
    ).json();
    expect(h.anchorBalance).toBe(200_000_000 - net);
    expect(h.player).toMatchObject({
      currency: "USD",
      maxStake: Math.floor((200_000_000 - net) * MAX_STAKE_SHARE),
    });
  });

  it("rejects a straight bet without a number and an unknown player", async () => {
    expect(
      (await play(post({ game: "roulette", discordId: "p1", stake: 10, bet: "straight" }))).status
    ).toBe(400);
    const missing = await play(post({ game: "slots", discordId: "nobody", stake: 10 }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/No user found/);
  });

  it("refuses an over-limit stake with the limit in the body", async () => {
    const res = await play(post({ game: "slots", discordId: "p1", stake: 30_000_000 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      currency: "USD",
      maxStake: 200_000_000 * MAX_STAKE_SHARE,
    });
    expect(await cash()).toBe(10_000_000);
  });

  it("runs a high-low hand through the route and resumes an open one", async () => {
    const started = await (
      await highlow(post({ action: "start", discordId: "p1", stake: 1000 }))
    ).json();
    expect(started.session.status).toBe("active");
    const again = await highlow(post({ action: "start", discordId: "p1", stake: 1000 }));
    expect(again.status).toBe(409);
    expect((await again.json()).session.sessionId).toBe(started.session.sessionId);
    const cashed = await (
      await highlow(
        post({ action: "cashout", discordId: "p1", sessionId: started.session.sessionId })
      )
    ).json();
    expect(cashed.session).toMatchObject({ status: "cashed", payout: 1000 });
    expect(await cash()).toBe(10_000_000);
  });

  it("opens a race, takes a bet, lists it and refunds it on cancel", async () => {
    const created = await (
      await createRound(
        post({ game: "race", discordId: "p1", channelId: "chan", bettingSeconds: 30 })
      )
    ).json();
    const id = created.round.roundId;
    const params = { params: Promise.resolve({ id }) };
    const bet = await roundAction(
      post({ action: "enter", discordId: "p1", stake: 5000, selection: "dragon" }),
      params
    );
    expect(bet.status).toBe(200);
    expect(await cash()).toBe(10_000_000 - 5000);
    const listed = await (
      await listRounds(new Request("http://test/api?game=race&status=open&channelId=chan"))
    ).json();
    expect(listed.rounds.map((r: { roundId: string }) => r.roundId)).toEqual([id]);
    expect((await roundAction(post({ action: "settle", discordId: "p1" }), params)).status).toBe(
      409
    );
    const cancelled = await (
      await roundAction(post({ action: "cancel", discordId: "p1" }), params)
    ).json();
    expect(cancelled.round.status).toBe("cancelled");
    expect(await cash()).toBe(10_000_000);
  });

  it("settles blackjack against the anchor bank in the old response shape", async () => {
    const placed = await placeWager(post({ discordId: "p1", wagerAmount: 2000, gameId: "bj_1" }));
    expect(placed.status).toBe(200);
    expect(await placed.json()).toMatchObject({ previousCash: 10_000_000, newCash: 9_998_000 });
    const resolved = await (
      await resolveHand(
        post({ discordId: "p1", gameId: "bj_1", result: "win", payoutMultiplier: 1.5 })
      )
    ).json();
    // 3:2 on 2000 is 3000, less the 5% edge.
    expect(resolved).toMatchObject({
      result: "win",
      payout: 2850,
      totalReturned: 4850,
      previousCash: 9_998_000,
      newCash: 10_002_850,
    });
    expect(await cash()).toBe(10_002_850);
    expect(
      (await resolveHand(post({ discordId: "p1", gameId: "bj_1", result: "loss" }))).status
    ).toBe(404);
  });
});
