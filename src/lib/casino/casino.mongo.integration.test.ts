/** Casino money paths against a real Mongo: every stake and payout must conserve value. */
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const emitted: { type: string; amount: number; currencyCode: string }[] = [];
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(
    async (_db: unknown, entry: { type: string; amount: number; currencyCode: string }) => {
      emitted.push(entry);
      return "applied";
    }
  ),
}));

import {
  CASINO_FUND_NAME,
  houseLimits,
  loadHouse,
  resolveCasinoPlayer,
  settleHouseBet,
  takeStake,
  type CasinoPlayer,
} from "./house";
import { actHighLow, startHighLow, sweepHighLow } from "./highlowSessions";
import {
  LOTTERY_MAX_TICKETS,
  LOTTERY_TICKET_ANCHOR,
  createRound,
  enterRound,
  settleRound,
  startRound,
  sweepRounds,
} from "./rounds";

const uri = process.env.FEDERATION_TEST_MONGO_URI;
const USD_RATE = 1.25;
const FRF_RATE = 5;

/** Rng that replays `values` and then repeats the last one. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe.skipIf(!uri)("Discord casino on isolated Mongo", () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Isolated loopback Mongo required");
    client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  });
  afterAll(async () => {
    await client?.close();
  });

  beforeEach(async () => {
    emitted.length = 0;
    db = client.db(`ahd_test_casino_${new ObjectId()}`);
    await db
      .collection("gameState")
      .insertOne({ _id: "current" as unknown as ObjectId, preset: "1991-default" });
    await db.collection("exchangeRates").insertMany([
      { _id: "US" as unknown as ObjectId, currencyCode: "USD", rate: USD_RATE },
      { _id: "FR" as unknown as ObjectId, currencyCode: "FRF", rate: FRF_RATE },
    ]);
    await db.collection("discordBotFunds").insertOne({
      name: CASINO_FUND_NAME,
      balance: 200_000_000,
      currencyBalances: { USD: 125_000_000, FRF: 0 },
      totalWagered: 0,
      totalPaidOut: 0,
      totalCollected: 0,
      gamesPlayed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
  afterEach(async () => {
    await db.dropDatabase();
  });

  async function seedPlayer(
    discordId: string,
    countryId: "US" | "FR",
    cash: number
  ): Promise<CasinoPlayer> {
    const userId = new ObjectId();
    const currency = countryId === "US" ? "USD" : "FRF";
    await db.collection("users").insertOne({ _id: userId, discordId, isBanned: false });
    await db.collection("characters").insertOne({
      _id: new ObjectId(),
      userId,
      name: `Player ${discordId}`,
      countryId,
      currencyBalances: { personal: { [currency]: cash } },
    });
    const resolved = await resolveCasinoPlayer(db, discordId);
    if (!resolved.ok) throw new Error(resolved.error);
    return resolved.player;
  }

  async function cash(player: CasinoPlayer): Promise<number> {
    const doc = await db.collection("characters").findOne({ _id: player.characterId });
    return doc?.currencyBalances.personal[player.currency] ?? 0;
  }

  async function bank(): Promise<number> {
    return (await loadHouse(db)).anchorBalance;
  }

  it("back-fills the anchor bank from the legacy currency buckets", async () => {
    expect(await bank()).toBe(100_000_000);
  });

  it("pays a house win from the anchor bank to a player in a currency nobody has lost in", async () => {
    const player = await seedPlayer("fr", "FR", 1_000_000);
    expect(player).toMatchObject({ currency: "FRF", rate: FRF_RATE });
    const limits = houseLimits(await bank());
    const taken = await takeStake(db, player, 100_000, limits);
    expect(taken.ok).toBe(true);
    const settled = await settleHouseBet(db, {
      player,
      game: "roulette",
      stakeLocal: 100_000,
      multiplier: 36,
      limits,
      meta: {},
    });
    expect(settled).toMatchObject({ ok: true, payout: 3_600_000 });
    expect(await cash(player)).toBe(4_500_000);
    expect(await bank()).toBeCloseTo(100_000_000 - 3_500_000 / FRF_RATE, 6);
    expect(emitted.map((e) => [e.type, e.amount])).toEqual([
      ["casino_wager", -100_000],
      ["casino_payout", 3_600_000],
    ]);
    const house = await db.collection("discordBotFunds").findOne({ name: CASINO_FUND_NAME });
    expect(house?.games.roulette).toMatchObject({
      played: 1,
      handleAnchor: 20_000,
      paidOutAnchor: 720_000,
    });
  });

  it("enforces the stake limit and wallet balance", async () => {
    const player = await seedPlayer("us", "US", 1_000);
    const limits = houseLimits(await bank());
    expect(await takeStake(db, player, 5_000, limits)).toMatchObject({ ok: false, status: 402 });
    const rich = await seedPlayer("rich", "US", 10_000_000_000);
    expect(await takeStake(db, rich, 3_000_000, limits)).toMatchObject({ ok: false, status: 400 });
    expect(await cash(rich)).toBe(10_000_000_000);
  });

  it("clips a win to the payout cap and voids the play when the bank is short", async () => {
    const player = await seedPlayer("us", "US", 1_000_000);
    const limits = houseLimits(await bank());
    await takeStake(db, player, 100_000, limits);
    const capped = await settleHouseBet(db, {
      player,
      game: "slots",
      stakeLocal: 100_000,
      multiplier: 288,
      limits,
      meta: {},
    });
    expect(capped).toMatchObject({
      ok: true,
      capped: true,
      payout: Math.floor(limits.maxPayoutAnchor * USD_RATE),
    });

    await db
      .collection("discordBotFunds")
      .updateOne({ name: CASINO_FUND_NAME }, { $set: { anchorBalance: 10 } });
    const before = await cash(player);
    await takeStake(db, player, 1_000, null);
    const short = await settleHouseBet(db, {
      player,
      game: "slots",
      stakeLocal: 1_000,
      multiplier: 10,
      limits,
      meta: {},
    });
    expect(short).toMatchObject({ ok: false, status: 503 });
    expect(await cash(player)).toBe(before);
    expect(await bank()).toBe(10);
  });

  it("plays high-low to a cash-out, a loss and an abandoned hand", async () => {
    const player = await seedPlayer("us", "US", 1_000_000);
    // Card 7, then an 11 (higher, correct).
    const started = await startHighLow(db, player, 10_000, seq(6 / 13 + 0.01));
    if (!started.ok) throw new Error(started.error);
    expect(started.session.card).toBe(7);
    const won = await actHighLow(
      db,
      "us",
      started.session._id.toString(),
      "higher",
      seq(10 / 13 + 0.01)
    );
    if (!won.ok) throw new Error(won.error);
    expect(won.session).toMatchObject({ steps: 1, card: 11 });
    const cashed = await actHighLow(db, "us", started.session._id.toString(), "cashout");
    if (!cashed.ok) throw new Error(cashed.error);
    expect(cashed.session.status).toBe("cashed");
    expect(await cash(player)).toBe(
      1_000_000 - 10_000 + Math.floor(10_000 * won.session.multiplier)
    );

    const second = await startHighLow(db, player, 10_000, seq(0.5));
    if (!second.ok) throw new Error(second.error);
    const lost = await actHighLow(db, "us", second.session._id.toString(), "higher", seq(0));
    expect(lost.ok && lost.session.status).toBe("lost");

    const third = await startHighLow(db, player, 10_000, seq(0.5));
    if (!third.ok) throw new Error(third.error);
    const balance = await cash(player);
    await sweepHighLow(db, new Date(Date.now() + 11 * 60_000));
    expect(await cash(player)).toBe(balance + 10_000);
  });

  it("splits a race pot between backers of the winner and keeps the rake", async () => {
    const host = await seedPlayer("a", "US", 1_000_000);
    const other = await seedPlayer("b", "FR", 1_000_000);
    const created = await createRound(db, {
      game: "race",
      hostDiscordId: "a",
      channelId: null,
      bettingSeconds: 15,
    });
    if (!created.ok) throw new Error(created.error);
    const id = created.round._id.toString();
    expect((await enterRound(db, id, host, { stake: 125_000, selection: "turtle" })).ok).toBe(true);
    expect((await enterRound(db, id, other, { stake: 500_000, selection: "rabbit" })).ok).toBe(
      true
    );
    expect(await enterRound(db, id, host, { stake: 1, selection: "rabbit" })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await settleRound(db, id, {}, seq(0))).toMatchObject({ ok: false, status: 409 });

    await db
      .collection("casinoRounds")
      .updateOne({ _id: created.round._id }, { $set: { closesAt: new Date(Date.now() - 1) } });
    const bankBefore = await bank();
    const settled = await settleRound(db, id, {}, seq(0, 0.5));
    if (!settled.ok) throw new Error(settled.error);
    expect(settled.round).toMatchObject({ status: "settled", outcome: { winner: "turtle" } });
    // Pot is 100k + 100k anchor; the turtle backer takes 95% of it.
    expect(await cash(host)).toBe(1_000_000 - 125_000 + Math.floor(190_000 * USD_RATE));
    expect(await cash(other)).toBe(500_000);
    expect(await bank()).toBeCloseTo(bankBefore + 10_000, 6);
  });

  it("refunds a race nobody backed the winner of", async () => {
    const a = await seedPlayer("a", "US", 1_000_000);
    const created = await createRound(db, { game: "race", hostDiscordId: "a", channelId: null });
    if (!created.ok) throw new Error(created.error);
    await enterRound(db, created.round._id.toString(), a, { stake: 50_000, selection: "dragon" });
    await db
      .collection("casinoRounds")
      .updateOne({ _id: created.round._id }, { $set: { closesAt: new Date(Date.now() - 1) } });
    const settled = await settleRound(db, created.round._id.toString(), {}, seq(0, 0.5));
    expect(settled.ok && settled.round.outcome).toMatchObject({ winner: "turtle", refunded: true });
    expect(await cash(a)).toBe(1_000_000);
  });

  it("runs one lottery draw per tier, caps tickets and draws by ticket weight", async () => {
    const a = await seedPlayer("a", "US", 1_000_000_000);
    const b = await seedPlayer("b", "US", 1_000_000_000);
    const first = await createRound(db, { game: "lottery", tier: "low", channelId: "c" });
    const again = await createRound(db, { game: "lottery", tier: "low", channelId: "c" });
    if (!first.ok || !again.ok) throw new Error("create failed");
    expect(again.created).toBe(false);
    expect(again.round._id.equals(first.round._id)).toBe(true);
    const id = first.round._id.toString();

    expect((await enterRound(db, id, a, { tickets: 60 })).ok).toBe(true);
    expect((await enterRound(db, id, a, { tickets: 40 })).ok).toBe(true);
    expect(await enterRound(db, id, a, { tickets: 1 })).toMatchObject({ ok: false, status: 409 });
    expect((await enterRound(db, id, b, { tickets: 1 })).ok).toBe(true);
    const ticket = LOTTERY_TICKET_ANCHOR.low * USD_RATE;
    expect(await cash(a)).toBe(1_000_000_000 - LOTTERY_MAX_TICKETS * ticket);

    await db
      .collection("casinoRounds")
      .updateOne({ _id: first.round._id }, { $set: { closesAt: new Date(Date.now() - 1) } });
    const settled = await settleRound(db, id, {}, seq(0.999));
    if (!settled.ok) throw new Error(settled.error);
    expect(settled.round.outcome?.winnerDiscordId).toBe("b");
    expect(await cash(b)).toBe(
      1_000_000_000 - ticket + Math.floor(101 * LOTTERY_TICKET_ANCHOR.low * 0.9 * USD_RATE)
    );
  });

  it("cashes a poker table out by chips, rejects bad counts and refunds an expired table", async () => {
    const host = await seedPlayer("h", "US", 10_000_000);
    const guest = await seedPlayer("g", "FR", 100_000_000);
    const table = await createRound(db, { game: "poker", host, channelId: null, buyIn: 125_000 });
    if (!table.ok) throw new Error(table.error);
    const id = table.round._id.toString();
    expect(await startRound(db, id, "h")).toMatchObject({ ok: false, status: 409 });
    await enterRound(db, id, host, {});
    await enterRound(db, id, guest, {});
    expect(await cash(guest)).toBe(100_000_000 - 500_000);
    expect(await startRound(db, id, "g")).toMatchObject({ ok: false });
    expect((await startRound(db, id, "h")).ok).toBe(true);
    expect(await enterRound(db, id, await seedPlayer("late", "US", 1_000_000), {})).toMatchObject({
      ok: false,
      status: 409,
    });

    expect(await settleRound(db, id, { chips: { h: 1500, g: 400 } })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await settleRound(db, id, { chips: { h: 2000 } })).toMatchObject({
      ok: false,
      status: 400,
    });
    const settled = await settleRound(db, id, { chips: { h: 2000, g: 0 } });
    if (!settled.ok) throw new Error(settled.error);
    // Host doubles a 100k anchor buy-in and pays 5% of the 100k profit.
    expect(await cash(host)).toBe(10_000_000 - 125_000 + Math.floor(195_000 * USD_RATE));
    expect(await cash(guest)).toBe(100_000_000 - 500_000);

    const stale = await createRound(db, { game: "poker", host, channelId: null, buyIn: 125_000 });
    if (!stale.ok) throw new Error(stale.error);
    await enterRound(db, stale.round._id.toString(), host, {});
    const before = await cash(host);
    await sweepRounds(db, new Date(Date.now() + 4 * 3_600_000));
    expect(await cash(host)).toBe(before + 125_000);
  });
});
