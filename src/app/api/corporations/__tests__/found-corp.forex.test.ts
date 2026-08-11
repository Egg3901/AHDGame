/**
 * Forex unit-invariant tests for corporation founding.
 * Verifies that starting capital is converted to the corp's home currency
 * using INITIAL_RATES, and that liquidCurrencyCode is set correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { CORPORATION_STARTING_CAPITAL } from "@/lib/constants/corporations";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/api/requireAuth");
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineCorpFounded: vi.fn().mockReturnValue("headline"),
}));

function makeDb(countryId: string) {
  const corpInsertedId = new ObjectId();
  const corpInsertOne = vi.fn().mockResolvedValue({ insertedId: corpInsertedId });

  // Typed rather than inferred: the inferred union is JPY-or-USD only, so the
  // UK case below (which reassigns to GBP) does not fit it.
  const charFunds: { personal: Record<string, number> } =
    countryId === "JP" ? { personal: { JPY: 2_000_000_000 } } : { personal: { USD: 2_000_000 } };

  const db = {
    corpInsertOne,
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "corporations") {
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: corpInsertOne,
          // openCeoTenure (founding) writes the founder's CEO tenure.
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        };
      }
      if (name === "counters") {
        return { findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }) };
      }
      if (name === "states") {
        return {
          findOne: vi.fn().mockResolvedValue({ _id: "jp_tokyo", name: "Tokyo" }),
        };
      }
      if (name === "corporationCeoVotes") {
        return { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
      }
      if (name === "characters") {
        // atomicallyDebitCharacterCash uses findOneAndUpdate — return the
        // post-debit character doc so the helper sees `ok: true`.
        return {
          findOne: vi.fn().mockResolvedValue(null),
          findOneAndUpdate: vi.fn().mockResolvedValue({
            _id: new ObjectId(),
            countryId,
            currencyBalances: charFunds,
          }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
      }
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
    }),
  };

  const character = {
    _id: new ObjectId(),
    countryId,
    homeState: countryId === "JP" ? "jp_tokyo" : "california",
    currencyBalances: charFunds,
    shareholders: [],
  };

  return { db, corpInsertOne, character };
}

describe("POST /api/corporations — forex enabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("JP corp: sets liquidCurrencyCode=JPY and converts starting capital via INITIAL_RATES", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { requireAuth } = await import("@/lib/api/requireAuth");
    const { db, corpInsertOne, character } = makeDb("JP");

    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        hasCharacter: true,
        character: character as never,
      },
    } as never);

    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/corporations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nippon Corp", tickerSymbol: "NIPN", type: "manufacturing" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const inserted = corpInsertOne.mock.calls[0][0];
    expect(inserted.liquidCurrencyCode).toBe("JPY");
    // INITIAL_RATES.JP = 106 — exact assertion, not sanity check
    expect(inserted.liquidCapital).toBe(CORPORATION_STARTING_CAPITAL * 106);
  });

  it("US corp: liquidCurrencyCode=USD and starting capital unchanged (rate=1.0)", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { requireAuth } = await import("@/lib/api/requireAuth");
    const { db, corpInsertOne, character } = makeDb("US");

    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        hasCharacter: true,
        character: character as never,
      },
    } as never);

    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/corporations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "American Corp", tickerSymbol: "AMER", type: "manufacturing" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const inserted = corpInsertOne.mock.calls[0][0];
    expect(inserted.liquidCurrencyCode).toBe("USD");
    // INITIAL_RATES.US = 1.0 → capital unchanged
    expect(inserted.liquidCapital).toBe(CORPORATION_STARTING_CAPITAL);
  });

  it("UK private founding stamps uk_ltd (not uk_plc) — ticket #1020", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { requireAuth } = await import("@/lib/api/requireAuth");
    const { db, corpInsertOne, character } = makeDb("UK");
    // makeDb only funds USD/JPY; UK founder needs GBP cash for the debit.
    character.currencyBalances = { personal: { GBP: 2_000_000 } };
    db.collection = vi.fn().mockImplementation((name: string) => {
      if (name === "corporations") {
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: corpInsertOne,
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        };
      }
      if (name === "counters") {
        return { findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }) };
      }
      if (name === "states") {
        return {
          findOne: vi.fn().mockResolvedValue({ _id: "london", name: "London" }),
        };
      }
      if (name === "corporationCeoVotes") {
        return { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
      }
      if (name === "characters") {
        return {
          findOne: vi.fn().mockResolvedValue(null),
          findOneAndUpdate: vi.fn().mockResolvedValue({
            _id: character._id,
            countryId: "UK",
            currencyBalances: character.currencyBalances,
          }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
      }
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      };
    });
    character.homeState = "london";

    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        hasCharacter: true,
        character: character as never,
      },
    } as never);

    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/corporations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Pierce & Pierce", tickerSymbol: "PP", type: "financial" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const inserted = corpInsertOne.mock.calls[0][0];
    expect(inserted.isPrivate).toBe(true);
    expect(inserted.legalStructure).toBe("uk_ltd");
  });
});
