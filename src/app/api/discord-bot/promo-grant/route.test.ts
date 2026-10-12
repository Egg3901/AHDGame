import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resetPromoGrantIndexMemo, type PromoGrant } from "@/lib/promo/promoGrants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));
vi.mock("@/lib/api/rateLimit", () => ({
  BOT_FINANCIAL_LIMITS: { maxRequests: 30, windowMs: 60_000 },
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(true) }));

const DISCORD_ID = "123456789012345678";
const CAMPAIGN = "itch-boost-2026-10";
const EUR_RATE = 0.9;

type Doc = Record<string, unknown>;

/** Minimal evaluator for the aggregation expressions the grant pipeline uses. */
function evalExpr(expr: unknown, doc: Doc): unknown {
  if (typeof expr === "string" && expr.startsWith("$")) {
    return expr
      .slice(1)
      .split(".")
      .reduce<unknown>((acc, key) => (acc as Doc | undefined)?.[key], doc);
  }
  if (Array.isArray(expr)) return expr.map((e) => evalExpr(e, doc));
  if (expr && typeof expr === "object" && !(expr instanceof Date)) {
    const [op, arg] = Object.entries(expr as Doc)[0];
    const args = arg as unknown[];
    switch (op) {
      case "$literal":
        return arg;
      case "$ifNull": {
        const v = evalExpr(args[0], doc);
        return v ?? evalExpr(args[1], doc);
      }
      case "$add":
        return args.reduce<number>((sum, a) => sum + Number(evalExpr(a, doc)), 0);
      case "$eq":
        return evalExpr(args[0], doc) === evalExpr(args[1], doc);
      case "$concatArrays":
        return args.flatMap((a) => evalExpr(a, doc) as unknown[]);
      case "$cond": {
        const c = arg as { if: unknown; then: unknown; else: unknown };
        return evalExpr(c.if, doc) ? evalExpr(c.then, doc) : evalExpr(c.else, doc);
      }
      default:
        throw new Error(`unsupported operator ${op}`);
    }
  }
  return expr;
}

function setPath(doc: Doc, path: string, value: unknown) {
  const keys = path.split(".");
  let cur = doc;
  for (const key of keys.slice(0, -1)) {
    cur[key] = (cur[key] as Doc | undefined) ?? {};
    cur = cur[key] as Doc;
  }
  cur[keys[keys.length - 1]] = value;
}

function duplicateKeyError() {
  return Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
}

describe("POST /api/discord-bot/promo-grant", () => {
  let db: MockDb;
  let grants: PromoGrant[];
  let character: Doc;
  let user: Doc;
  let failNextCredit: boolean;

  function post(body: Doc) {
    return new Request("https://example.com/api/discord-bot/promo-grant", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Bot-Token": "token" },
      body: JSON.stringify(body),
    });
  }

  function matchesGrant(grant: PromoGrant, filter: Doc): boolean {
    for (const [key, cond] of Object.entries(filter)) {
      if (key === "$or") {
        if (!(cond as Doc[]).some((c) => matchesGrant(grant, c))) return false;
        continue;
      }
      const value = (grant as unknown as Doc)[key];
      if (cond instanceof ObjectId) {
        if (!(value instanceof ObjectId) || !value.equals(cond)) return false;
      } else if (cond && typeof cond === "object" && "$lt" in (cond as Doc)) {
        if (!((value as Date) < ((cond as Doc).$lt as Date))) return false;
      } else if (value !== cond) {
        return false;
      }
    }
    return true;
  }

  function applyGrantUpdate(grant: PromoGrant, update: Doc) {
    Object.assign(grant, update.$set ?? {});
    for (const [k, v] of Object.entries((update.$inc as Doc) ?? {})) {
      (grant as unknown as Doc)[k] = Number((grant as unknown as Doc)[k] ?? 0) + Number(v);
    }
    for (const k of Object.keys((update.$unset as Doc) ?? {})) {
      delete (grant as unknown as Doc)[k];
    }
  }

  async function run(body: Doc) {
    const { POST } = await import("./route");
    const res = await POST(post(body));
    return { status: res.status, json: await res.json() };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    resetPromoGrantIndexMemo();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireBotToken } = await import("@/lib/api/requireBotToken");
    vi.mocked(requireBotToken).mockReturnValue(true);

    grants = [];
    failNextCredit = false;
    user = { _id: new ObjectId(), username: "player-one", discordId: DISCORD_ID };
    character = {
      _id: new ObjectId(),
      userId: user._id,
      name: "Test Character",
      countryId: "DE",
      currencyBalances: { campaign: 0, personal: { EUR: 100 } },
    };

    const users = db.collection("users");
    users.findOne.mockImplementation(async (filter: Doc) =>
      filter.discordId === user.discordId ? user : null
    );

    const rates = db.collection("exchangeRates");
    rates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "DE", rate: EUR_RATE, currencyCode: "EUR" }]),
    });

    const characters = db.collection("characters");
    characters.findOne.mockImplementation(async (filter: Doc) => {
      if (filter.promoGrantReceipts !== undefined) {
        const receipts = (character.promoGrantReceipts as string[] | undefined) ?? [];
        if (!receipts.includes(filter.promoGrantReceipts as string)) return null;
        if (filter._id && !(filter._id as ObjectId).equals(character._id as ObjectId)) return null;
        return { _id: character._id };
      }
      if (filter._id && !(filter._id as ObjectId).equals(character._id as ObjectId)) return null;
      if (!(filter.userId as ObjectId).equals(character.userId as ObjectId)) return null;
      return character;
    });
    characters.updateOne.mockImplementation(async (filter: Doc, pipeline: Doc[]) => {
      if (failNextCredit) {
        failNextCredit = false;
        throw new Error("write conflict");
      }
      const receipt = (filter.promoGrantReceipts as Doc).$ne as string;
      const receipts = (character.promoGrantReceipts as string[] | undefined) ?? [];
      if (
        !(filter._id as ObjectId).equals(character._id as ObjectId) ||
        receipts.includes(receipt)
      ) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      const snapshot = structuredClone(character);
      for (const [path, expr] of Object.entries(pipeline[0].$set as Doc)) {
        setPath(character, path, evalExpr(expr, snapshot));
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    const promo = db.collection("promoGrants");
    promo.insertOne.mockImplementation(async (doc: PromoGrant) => {
      if (
        grants.some(
          (g) =>
            g.campaign === doc.campaign &&
            (g.userId.equals(doc.userId) || g.discordId === doc.discordId)
        )
      ) {
        throw duplicateKeyError();
      }
      grants.push(doc);
      return { insertedId: doc._id };
    });
    promo.findOne.mockImplementation(
      async (filter: Doc) => grants.find((g) => matchesGrant(g, filter)) ?? null
    );
    promo.findOneAndUpdate.mockImplementation(async (filter: Doc, update: Doc) => {
      const grant = grants.find((g) => matchesGrant(g, filter));
      if (!grant) return null;
      applyGrantUpdate(grant, update);
      return { ...grant };
    });
    promo.updateOne.mockImplementation(async (filter: Doc, update: Doc) => {
      const grant = grants.find((g) => matchesGrant(g, filter));
      if (!grant) return { matchedCount: 0, modifiedCount: 0 };
      applyGrantUpdate(grant, update);
      return { matchedCount: 1, modifiedCount: 1 };
    });
  });

  const validBody = { campaign: CAMPAIGN, discordId: DISCORD_ID, claimRef: "claim-1" };

  it("returns 401 without a valid bot token", async () => {
    const { requireBotToken } = await import("@/lib/api/requireBotToken");
    vi.mocked(requireBotToken).mockReturnValue(false);
    const { status } = await run(validBody);
    expect(status).toBe(401);
    expect(requireBotToken).toHaveBeenCalledWith(expect.any(Request), false);
  });

  it("returns 400 for an unknown campaign", async () => {
    const { status, json } = await run({ ...validBody, campaign: "nope" });
    expect(status).toBe(400);
    expect(json.error).toBe("Unknown campaign");
  });

  it("returns 400 for a malformed body and never accepts an amount", async () => {
    expect((await run({ ...validBody, discordId: "abc" })).status).toBe(400);
    expect((await run({ campaign: CAMPAIGN, discordId: DISCORD_ID })).status).toBe(400);
    expect((await run({ ...validBody, characterId: "not-hex" })).status).toBe(400);
    const withAmount = await run({ ...validBody, amountAnchor: 999_999_999 });
    expect(withAmount.json.amountAnchor).toBe(5_000_000);
  });

  it("returns 404 when no account is linked to the Discord id", async () => {
    const { status, json } = await run({ ...validBody, discordId: "999999999999999999" });
    expect(status).toBe(404);
    expect(json.error).toBe("No linked account");
  });

  it("returns 404 when the user has no active character", async () => {
    character.userId = new ObjectId();
    const { status, json } = await run(validBody);
    expect(status).toBe(404);
    expect(json.error).toBe("No active character");
  });

  it("returns 404 when characterId belongs to someone else", async () => {
    const { status, json } = await run({
      ...validBody,
      characterId: new ObjectId().toHexString(),
    });
    expect(status).toBe(404);
    expect(json.error).toBe("No active character");
  });

  it("credits the home currency at the live FX rate and writes the tx log", async () => {
    const { status, json } = await run(validBody);
    expect(status).toBe(200);
    expect(json).toEqual({
      status: "granted",
      campaign: CAMPAIGN,
      characterId: (character._id as ObjectId).toHexString(),
      characterName: "Test Character",
      countryId: "DE",
      currency: "EUR",
      amountAnchor: 5_000_000,
      amountLocal: 5_000_000 * EUR_RATE,
      claimRef: "claim-1",
    });
    const balances = character.currencyBalances as { personal: Record<string, number> };
    expect(balances.personal.EUR).toBe(100 + 5_000_000 * EUR_RATE);
    expect(grants[0].status).toBe("granted");
    expect(grants[0].grantedAt).toBeInstanceOf(Date);

    const promo = db.collection("promoGrants");
    expect(promo.createIndex).toHaveBeenCalledWith(
      { campaign: 1, userId: 1 },
      expect.objectContaining({ unique: true })
    );
    expect(promo.createIndex).toHaveBeenCalledWith(
      { campaign: 1, discordId: 1 },
      expect.objectContaining({ unique: true })
    );

    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(emitTxBulk).toHaveBeenCalledTimes(1);
    const [entry] = vi.mocked(emitTxBulk).mock.calls[0][1];
    expect(entry).toMatchObject({
      type: "admin_transfer",
      subjectType: "character",
      amount: 5_000_000 * EUR_RATE,
      anchorAmount: 5_000_000,
      currencyCode: "EUR",
      meta: expect.objectContaining({ reason: "promotional_grant", campaign: CAMPAIGN }),
    });
    const { createAdminLog } = await import("@/lib/adminLog");
    expect(createAdminLog).toHaveBeenCalledTimes(1);
  });

  it("returns already_granted on a second claim without crediting again", async () => {
    await run(validBody);
    const balances = character.currencyBalances as { personal: Record<string, number> };
    const afterFirst = balances.personal.EUR;

    const { status, json } = await run({ ...validBody, claimRef: "claim-2" });
    expect(status).toBe(200);
    expect(json.status).toBe("already_granted");
    expect(json.claimRef).toBe("claim-1");
    expect(balances.personal.EUR).toBe(afterFirst);
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(emitTxBulk).toHaveBeenCalledTimes(1);
  });

  it("returns already_granted when a concurrent claim wins the insert race", async () => {
    const promo = db.collection("promoGrants");
    const winner: PromoGrant = {
      _id: new ObjectId(),
      campaign: CAMPAIGN,
      userId: user._id as ObjectId,
      discordId: DISCORD_ID,
      characterId: character._id as ObjectId,
      characterName: "Test Character",
      countryId: "DE",
      claimRef: "racer",
      amountAnchor: 5_000_000,
      currency: "EUR",
      amountLocal: 5_000_000 * EUR_RATE,
      rate: EUR_RATE,
      status: "pending",
      createdAt: new Date(),
      attemptStartedAt: new Date(),
      attempts: 1,
      grantedAt: null,
    };
    // The racing request inserts between our read of nothing and our insert.
    promo.insertOne.mockImplementationOnce(async () => {
      grants.push(winner);
      throw duplicateKeyError();
    });

    const { status, json } = await run(validBody);
    expect(status).toBe(200);
    expect(json.status).toBe("already_granted");
    expect(json.claimRef).toBe("racer");
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("marks a failed credit as failed and a retry re-attempts exactly once", async () => {
    failNextCredit = true;
    const first = await run(validBody);
    expect(first.status).toBe(500);
    expect(grants[0].status).toBe("failed");
    expect(grants[0].error).toBe("write conflict");
    const balances = character.currencyBalances as { personal: Record<string, number> };
    expect(balances.personal.EUR).toBe(100);

    const [retry, concurrent] = await Promise.all([run(validBody), run(validBody)]);
    const statuses = [retry.json.status, concurrent.json.status].sort();
    expect(statuses).toEqual(["already_granted", "granted"]);
    expect(balances.personal.EUR).toBe(100 + 5_000_000 * EUR_RATE);
    expect(grants).toHaveLength(1);
    expect(grants[0].status).toBe("granted");
    expect(grants[0].attempts).toBe(2);

    const again = await run(validBody);
    expect(again.json.status).toBe("already_granted");
    expect(balances.personal.EUR).toBe(100 + 5_000_000 * EUR_RATE);
  });

  it("does not pay twice when a stale pending claim was already credited", async () => {
    // Simulate a crash after the credit but before the status flip.
    await run(validBody);
    grants[0].status = "pending";
    grants[0].attemptStartedAt = new Date(Date.now() - 11 * 60 * 1000);
    const balances = character.currencyBalances as { personal: Record<string, number> };
    const paid = balances.personal.EUR;

    const { json } = await run(validBody);
    expect(json.status).toBe("granted");
    expect(balances.personal.EUR).toBe(paid);
    expect(grants[0].status).toBe("granted");
  });

  it("leaves a fresh pending claim to the request that owns it", async () => {
    await run(validBody);
    grants[0].status = "pending";
    grants[0].attemptStartedAt = new Date();
    const { json } = await run(validBody);
    expect(json.status).toBe("already_granted");
    expect(grants[0].status).toBe("pending");
  });
});
