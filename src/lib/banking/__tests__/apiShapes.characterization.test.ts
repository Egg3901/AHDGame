/**
 * Characterization tests for the banking API surface.
 *
 * These pin the SHAPE of every player-facing banking response: the exact set
 * of top-level keys, and the keys of the nested objects a client reads. They
 * assert nothing about the numbers. Their job is to let the rebuild replace
 * internals underneath these routes without a client discovering a renamed or
 * dropped field in production.
 *
 * A change that legitimately alters a response updates the expected key list
 * here in the same commit, which is the review prompt it exists to create.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// The console route pulls in most of the banking module graph; under a loaded
// parallel run its first import can exceed the default budget.
vi.setConfig({ testTimeout: 60_000 });

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
  requireAuthWithCharacter: vi.fn(),
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ _id: "current", currentTurn: 100 }),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendMultiCountryGameEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/centralBankWebhook", () => ({
  buildPrimeRateChangeEmbed: vi.fn(() => ({})),
}));
vi.mock("@/lib/extraction/contractIssuerAuth", () => ({
  isNationalIssuer: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/centralBank/governance", () => ({
  isBankGovernmentControlledLive: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/mail/systemMail", () => ({ sendSystemMail: vi.fn() }));

function sortedKeys(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort();
}

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

const USER_ID = new ObjectId();
const CHARACTER_ID = new ObjectId();
const BANK_ID = new ObjectId();
const BORROWER_CORP_ID = new ObjectId();

function retailCharter() {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 10_000_000,
    cashReserves: 10_000_000,
    npcDeposits: 5_000_000,
    totalDeposits: 5_000_000,
    totalLoans: 0,
    depositOffset: 0,
    lendingOffset: 0,
    blacklist: {},
  };
}

function bankCorp() {
  return {
    _id: BANK_ID,
    sequentialId: 7,
    name: "First Test Bank",
    type: "financial",
    userId: USER_ID,
    ceoId: CHARACTER_ID,
    liquidCapital: 1_000_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    headquartersState: "CA",
    bankCharter: retailCharter(),
  };
}

function borrowerCorp() {
  return {
    _id: BORROWER_CORP_ID,
    sequentialId: 8,
    name: "Borrower Inc",
    type: "manufacturing",
    userId: USER_ID,
    ceoId: CHARACTER_ID,
    liquidCapital: 500_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    headquartersState: "CA",
  };
}

function character() {
  return {
    _id: CHARACTER_ID,
    userId: USER_ID,
    name: "Test Character",
    countryId: "US",
    sequentialId: 3,
    savingsAccountsOpened: { USD: true },
    currencyBalances: {
      personal: { USD: 50_000 },
      savings: { USD: 20_000 },
      savingsHolder: { USD: "centralBank" },
    },
  };
}

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "gameConfig",
    "gameState",
    "corporations",
    "characters",
    "corporateSectors",
    "centralBanks",
    "bankLoans",
    "interbankLoans",
    "bankingLaws",
    "corporationHistory",
    "exchangeRates",
    "financialTxLog",
    "savingsLedger",
    "indexFunds",
    "systemSettings",
    "actionAuditLog",
  ]) {
    db.collection(name);
  }
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
    _id: "default",
    privateBankingEnabled: true,
  });
  db.collectionMocks.gameState!.findOne.mockResolvedValue({
    _id: "current",
    currentTurn: 100,
    preset: "2019-default",
  });
  db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
    _id: "US",
    countryId: "US",
    primeRate: 4,
    bankReserveRequirement: 0.1,
    inflationHistory: [],
  });

  const corps = new Map<string, unknown>([
    [BANK_ID.toString(), bankCorp()],
    [BORROWER_CORP_ID.toString(), borrowerCorp()],
  ]);
  db.collectionMocks.corporations!.findOne.mockImplementation(
    async (filter: { _id?: ObjectId; sequentialId?: number }) => {
      if (filter?._id) return corps.get(filter._id.toString()) ?? null;
      if (filter?.sequentialId === 7) return bankCorp();
      if (filter?.sequentialId === 8) return borrowerCorp();
      return null;
    }
  );
  db.collectionMocks.corporations!.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks.corporations!.find.mockReturnValue(cursor([]));

  db.collectionMocks.characters!.findOne.mockResolvedValue(character());
  db.collectionMocks.characters!.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  db.collectionMocks.characters!.find.mockReturnValue(cursor([]));
  db.collectionMocks.characters!.aggregate.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([{ total: 0 }]),
  });

  db.collectionMocks.corporateSectors!.findOne.mockResolvedValue({ _id: new ObjectId() });
  db.collectionMocks.corporateSectors!.find.mockReturnValue(
    cursor([{ capitalStock: 1_000, sectorType: "financial", revenue: 0 }])
  );
  db.collectionMocks.bankLoans!.find.mockReturnValue(cursor([]));
  db.collectionMocks.bankLoans!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  db.collectionMocks.interbankLoans!.find.mockReturnValue(cursor([]));
  db.collectionMocks.corporationHistory!.find.mockReturnValue(
    cursor(Array.from({ length: 12 }, (_, i) => ({ turn: 89 + i, income: 1_000_000 })))
  );
  db.collectionMocks.exchangeRates!.find.mockReturnValue(cursor([]));
  db.collectionMocks.financialTxLog!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  db.collectionMocks.financialTxLog!.insertMany.mockResolvedValue({ insertedCount: 0 });
  db.collectionMocks.savingsLedger!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
});

async function authAs(kind: "auth" | "character" | "basic", isAdmin = false) {
  const mod = await import("@/lib/api/requireAuth");
  const user = {
    userId: USER_ID.toString(),
    username: "tester",
    isAdmin,
    character: { ...character() },
  };
  const result = { ok: true, user } as never;
  vi.mocked(mod.requireAuth).mockResolvedValue(result);
  vi.mocked(mod.requireAuthWithCharacter).mockResolvedValue(result);
  vi.mocked(mod.requireBasicAuth).mockResolvedValue(result);
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/banking/corporation/[id]", () => {
  it("keeps the console payload shape", async () => {
    await authAs("auth");
    const { GET } = await import("@/app/api/banking/corporation/[id]/route");
    const res = await GET(new Request(`http://localhost/api/banking/corporation/${BANK_ID}`), {
      params: Promise.resolve({ id: BANK_ID.toString() }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sortedKeys(body)).toEqual([
      "bankPropTradingEnabled",
      "blacklistableFunds",
      "canMutate",
      "canRevoke",
      "capitalRequirement",
      "capitalRequirementByType",
      "caps",
      "charter",
      "corporation",
      "corridors",
      "currency",
      "currentTurn",
      "defaultBranchCapacityShare",
      "depositCeiling",
      "eligibilityReasons",
      "eligibleTypes",
      "householdBook",
      "interbankLoans",
      "isAdmin",
      "isCeo",
      "isChair",
      "legalCharterTypes",
      "loans",
      "privateBankingEnabled",
      "rates",
      "reserveRatio",
      "risk",
      "visible",
    ]);
    expect(sortedKeys(body.charter)).toEqual([
      "appliedStressLossFraction",
      "blacklist",
      "branchCapacityShare",
      "capitalRatio",
      "capitalStanding",
      "cashReserves",
      "cbMarginArrears",
      "cbMarginDebt",
      "charterSwitchCooldownUntilTurn",
      "charteredTurn",
      "confidence",
      "currency",
      "depositCeiling",
      "depositOffset",
      "discountWindowArrears",
      "discountWindowDebt",
      "interbankDebt",
      "lendingOffset",
      "lendingProfile",
      "npcDeposits",
      "panicTurns",
      "postedCapital",
      "propBook",
      "propBookMarkValue",
      "requireApproval",
      "requiredReserves",
      "status",
      "stressedCapitalRatio",
      "totalDeposits",
      "totalLoans",
      "type",
      "upstreamCapacity",
      "warningBand",
    ]);
    expect(sortedKeys(body.rates)).toEqual(["depositRatePercent", "lendingRatePercent"]);
    expect(sortedKeys(body.householdBook)).toEqual([
      "blendedExpectedDefaultPercent",
      "blendedRatePercent",
      "lendingProfile",
      "rows",
      "total",
    ]);
    expect(body.caps.map((cap: { key: string }) => cap.key)).toEqual([
      "bookEquity",
      "requiredReserves",
      "depositCeiling",
      "distributable",
      "runLine",
    ]);
  });

  it("keeps the not-visible shape for an unrelated corporation", async () => {
    await authAs("auth");
    db.collectionMocks.corporateSectors!.findOne.mockResolvedValue(null);
    const { GET } = await import("@/app/api/banking/corporation/[id]/route");
    const res = await GET(
      new Request(`http://localhost/api/banking/corporation/${BORROWER_CORP_ID}`),
      { params: Promise.resolve({ id: BORROWER_CORP_ID.toString() }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.visible).toBe(false);
    expect(sortedKeys(body)).toEqual([
      "bankPropTradingEnabled",
      "canMutate",
      "canRevoke",
      "capitalRequirement",
      "charter",
      "corporation",
      "corridors",
      "currency",
      "depositCeiling",
      "eligibilityReasons",
      "eligibleTypes",
      "interbankLoans",
      "isAdmin",
      "isCeo",
      "isChair",
      "legalCharterTypes",
      "loans",
      "privateBankingEnabled",
      "rates",
      "reserveRatio",
      "visible",
    ]);
  });
});

describe("PUT /api/character/savings-holder", () => {
  it("keeps the success shape", async () => {
    await authAs("character");
    const { PUT } = await import("@/app/api/character/savings-holder/route");
    const res = await PUT(
      jsonRequest("http://localhost/api/character/savings-holder", "PUT", {
        currency: "USD",
        holder: BANK_ID.toString(),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sortedKeys(body)).toEqual(["currency", "holder", "success"]);
    expect(body.holder).toBe(BANK_ID.toString());
  });

  it("keeps the error shape", async () => {
    await authAs("character");
    const { PUT } = await import("@/app/api/character/savings-holder/route");
    const res = await PUT(
      jsonRequest("http://localhost/api/character/savings-holder", "PUT", {
        currency: "GBP",
        holder: BANK_ID.toString(),
      })
    );
    expect(res.status).toBe(400);
    expect(sortedKeys(await res.json())).toEqual(["error"]);
  });
});

describe("POST /api/character/savings/deposit and /withdraw", () => {
  it("keeps the deposit shape, with the optional routing fields when a holder is given", async () => {
    await authAs("basic");
    const { POST } = await import("@/app/api/character/savings/deposit/route");
    const plain = await POST(
      jsonRequest("http://localhost/api/character/savings/deposit", "POST", {
        currency: "USD",
        amount: 100,
      })
    );
    expect(plain.status).toBe(200);
    expect(sortedKeys(await plain.json())).toEqual(["amount", "currency", "success"]);

    const routed = await POST(
      jsonRequest("http://localhost/api/character/savings/deposit", "POST", {
        currency: "USD",
        amount: 100,
        holder: BANK_ID.toString(),
      })
    );
    expect(routed.status).toBe(200);
    expect(sortedKeys(await routed.json())).toEqual([
      "amount",
      "currency",
      "holderRouted",
      "success",
    ]);
  });

  it("keeps the withdraw shape", async () => {
    await authAs("basic");
    const { POST } = await import("@/app/api/character/savings/withdraw/route");
    const res = await POST(
      jsonRequest("http://localhost/api/character/savings/withdraw", "POST", {
        currency: "USD",
        amount: 100,
      })
    );
    expect(res.status).toBe(200);
    expect(sortedKeys(await res.json())).toEqual(["amount", "currency", "success"]);
  });
});

describe("POST /api/banking/loans", () => {
  it("keeps the origination shape", async () => {
    await authAs("character");
    const { POST } = await import("@/app/api/banking/loans/route");
    const res = await POST(
      jsonRequest("http://localhost/api/banking/loans", "POST", {
        bankCorporationId: BANK_ID.toString(),
        borrowerType: "corporation",
        borrowerCorporationId: BORROWER_CORP_ID.toString(),
        principal: 10_000,
        termTurns: 48,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sortedKeys(body)).toEqual(["creditedTo", "loan", "pending", "success"]);
    expect(sortedKeys(body.creditedTo)).toEqual(["destination", "kind", "name"]);
    expect(sortedKeys(body.loan)).toEqual([
      "_id",
      "bankCorporationId",
      "borrowerId",
      "borrowerType",
      "currency",
      "originatedTurn",
      "outstanding",
      "principal",
      "ratePercent",
      "status",
      "termTurns",
    ]);
  });
});

describe("POST /api/country/[code]/central-bank/rate", () => {
  it("keeps the rate-change shape", async () => {
    await authAs("auth");
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      chairCharacterId: CHARACTER_ID,
      chairCharacterName: "Test Character",
      primeRate: 4,
      rateHistory: [],
    });
    db.collectionMocks.exchangeRates!.findOne.mockResolvedValue(null);
    db.collectionMocks.centralBanks!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    const { POST } = await import("@/app/api/country/[code]/central-bank/rate/route");
    const res = await POST(
      jsonRequest("http://localhost/api/country/US/central-bank/rate", "POST", { rate: 4.25 }),
      { params: Promise.resolve({ code: "US" }) }
    );
    expect(res.status).toBe(200);
    expect(sortedKeys(await res.json())).toEqual(["primeRate", "scrutinyApplied", "success"]);
  });
});

describe("GET /api/country/[code]/fomc and POST /vote", () => {
  function board() {
    return Array.from({ length: 7 }, (_, i) => ({
      seatId: `seat-${i + 1}`,
      isChair: i === 0,
      occupantType: i === 1 ? "player" : "npp",
      characterId: i === 1 ? CHARACTER_ID : null,
      characterName: i === 1 ? "Test Character" : `Governor ${i + 1}`,
      nppId: i === 1 ? null : new ObjectId(),
      alignment: i % 2 === 0 ? "hawk" : "dove",
      appointedByPresidentId: null,
      appointedAtTurn: 1,
      termExpiresAtTurn: 500,
    }));
  }

  function meeting() {
    return {
      meetingId: new ObjectId().toHexString(),
      openedAtTurn: 96,
      openedAt: new Date(Date.UTC(2026, 0, 1)),
      motion: "hike",
      proposedDelta: 0.25,
      status: "voting",
      ballots: [],
      // Far-future wall-clock deadline: the machine refuses ballots past the
      // player window, so the fixture must stay inside it to ballot.
      playerVoteDeadline: new Date(Date.UTC(2030, 0, 2)),
      resolvesOnTurn: 120,
    };
  }

  beforeEach(() => {
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      primeRate: 4,
      rateHistory: [],
      fomcBoard: board(),
      activeFomcMeeting: meeting(),
      rateChangesThisTerm: 2,
      fomcTermStartedAtTurn: 1,
      lastFomcMeetingTurn: 96,
      fomcMeetingHistory: [],
    });
    db.collectionMocks.centralBanks!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collection("fomcNominations").find.mockReturnValue(cursor([]));
    db.collection("electedOfficials").findOne.mockResolvedValue(null);
    db.collection("npps").find.mockReturnValue(cursor([]));
  });

  it("keeps the committee panel shape", async () => {
    await authAs("character");
    const { GET } = await import("@/app/api/country/[code]/fomc/route");
    const res = await GET(new Request("http://localhost/api/country/US/fomc"), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sortedKeys(body)).toEqual([
      "board",
      "canNominate",
      "currentTurn",
      "governance",
      "hasCommittee",
      "majorityNeeded",
      "meeting",
      "meetingHistory",
      "nextMeetingAtTurn",
      "nominations",
      "primeRate",
      "rateChangesPerTerm",
      "rateChangesThisTerm",
      "termEndsAtTurn",
      "viewerIsSenator",
      "viewerSeatId",
    ]);
    expect(sortedKeys(body.governance)).toEqual([
      "allowedActions",
      "currency",
      "institutionId",
      "memberCountryIds",
      "nextDeadline",
      "normalizedRateChoices",
      "primeRateOnGrid",
      "viewerRole",
    ]);
    for (const action of body.governance.allowedActions) {
      expect(action.action).toBeTruthy();
      expect(typeof action.allowed).toBe("boolean");
    }
    const ballot = body.governance.allowedActions.find(
      (action: { action: string }) => action.action === "cast_ballot"
    );
    expect(sortedKeys(ballot)).toEqual(["action", "allowed", "deadlineTurn", "nextDeadline"]);
    expect(sortedKeys(body.governance.nextDeadline)).toEqual(["kind", "turn"]);
    expect(sortedKeys(body.meeting)).toEqual([
      "agree",
      "disagree",
      "motion",
      "needed",
      "playerVoteDeadline",
      "proposedDelta",
      "resolvesOnTurn",
      "viewerCanVote",
      "viewerHasVoted",
    ]);
    expect(sortedKeys(body.board[0])).toEqual([
      "alignment",
      "isChair",
      "name",
      "occupantType",
      "seatId",
      "termExpiresAtTurn",
    ]);
  });

  it("keeps the ballot shape", async () => {
    await authAs("character");
    const { POST } = await import("@/app/api/country/[code]/fomc/vote/route");
    const res = await POST(
      jsonRequest("http://localhost/api/country/US/fomc/vote", "POST", { vote: "hike" }),
      { params: Promise.resolve({ code: "US" }) }
    );
    expect(res.status).toBe(200);
    expect(sortedKeys(await res.json())).toEqual(["motion", "ok", "rateChanged", "resolved"]);
  });
});
