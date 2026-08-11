import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendMultiCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { primeRateCut: 0x57f287, primeRateHike: 0xed4245 },
}));

let db: MockDb;

const chairCharacterId = new ObjectId();

function makeMockUser(overrides: Record<string, unknown> = {}) {
  // Fresh userId per call to avoid cross-test rate-limit accumulation.
  return {
    userId: new ObjectId().toString(),
    username: "testuser",
    isAdmin: false,
    character: {
      _id: chairCharacterId,
      name: "Jerome Powell",
    },
    ...overrides,
  };
}

function makeMockBank(overrides: Record<string, unknown> = {}) {
  return {
    _id: "US",
    countryId: "US",
    chairCharacterId,
    chairCharacterName: "Jerome Powell",
    primeRate: 2.0,
    rateHistory: [],
    chairControlsLocked: false,
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/US/central-bank/rate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ code: "US" }) });

async function setup({
  bank = makeMockBank(),
  user = makeMockUser(),
}: {
  bank?: ReturnType<typeof makeMockBank>;
  user?: ReturnType<typeof makeMockUser>;
} = {}) {
  db = createMockDb();
  // Materialize the centralBanks collection mock and stub findOne to return our bank.
  db.collection("centralBanks").findOne.mockResolvedValue(bank);

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user } as never);
}

describe("POST /api/country/[code]/central-bank/rate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires the rate-change webhook on a successful rate cut", async () => {
    await setup();
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const res = await POST(makeRequest({ rate: 1.75 }), ctx());

    expect(res.status).toBe(200);
    expect(sendMultiCountryGameEvent).toHaveBeenCalledTimes(1);
    const [recipients, embed] = vi.mocked(sendMultiCountryGameEvent).mock.calls[0]!;
    expect(recipients).toEqual(["US"]);
    expect(embed.title).toBe("Federal Reserve — Rate Cut");
    expect(embed.description).toContain("lowered from 2.00% to 1.75%");
    expect(embed.description).toContain("(-25 bps)");
  });

  it("fires the rate-change webhook on a successful rate hike with reason", async () => {
    await setup();
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const res = await POST(makeRequest({ rate: 2.5, reason: "Combat inflation." }), ctx());

    expect(res.status).toBe(200);
    expect(sendMultiCountryGameEvent).toHaveBeenCalledTimes(1);
    const [, embed] = vi.mocked(sendMultiCountryGameEvent).mock.calls[0]!;
    expect(embed.title).toBe("Federal Reserve — Rate Hike");
    expect(embed.fields?.find((f) => f.name === "Reason")?.value).toBe("Combat inflation.");
  });

  it("labels admin overrides in the Chair field via existing changedByName", async () => {
    const adminUser = makeMockUser({
      isAdmin: true,
      character: { _id: new ObjectId(), name: "Site Admin" },
    });
    await setup({ user: adminUser });
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const res = await POST(makeRequest({ rate: 2.5 }), ctx());

    expect(res.status).toBe(200);
    const [, embed] = vi.mocked(sendMultiCountryGameEvent).mock.calls[0]!;
    expect(embed.fields?.find((f) => f.name === "Chair")?.value).toBe("Site Admin (admin)");
  });

  it("does not fire webhook on validation failure (out-of-range rate)", async () => {
    await setup();
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const res = await POST(makeRequest({ rate: 99 }), ctx());

    expect(res.status).toBe(400);
    expect(sendMultiCountryGameEvent).not.toHaveBeenCalled();
  });

  it("does not fire webhook when new rate equals current rate", async () => {
    await setup({ bank: makeMockBank({ primeRate: 2.0 }) });
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const res = await POST(makeRequest({ rate: 2.0 }), ctx());

    expect(res.status).toBe(400);
    expect(sendMultiCountryGameEvent).not.toHaveBeenCalled();
  });

  it("does not fire webhook when permission is denied (chair locked, not admin)", async () => {
    await setup({ bank: makeMockBank({ chairControlsLocked: true }) });
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const res = await POST(makeRequest({ rate: 2.5 }), ctx());

    expect(res.status).toBe(403);
    expect(sendMultiCountryGameEvent).not.toHaveBeenCalled();
  });

  it("rejects chair rate hikes exceeding the 0.75% delta cap", async () => {
    await setup({ bank: makeMockBank({ primeRate: 2.0 }) });
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const res = await POST(makeRequest({ rate: 3.0 }), ctx());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/0\.75%/);
    expect(sendMultiCountryGameEvent).not.toHaveBeenCalled();
  });

  it("allows aggressive cut (>0.75pp) up to 1.75pp and applies scrutiny", async () => {
    await setup({ bank: makeMockBank({ primeRate: 4.0, chairInfamy: 5 }) });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ rate: 2.25 }), ctx()); // -1.75 cut

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scrutinyApplied).toBe(true);
    // Verify chairInfamy update was written: db.collection().updateOne should have been called
    // with the new infamy value (5 + 10 = 15).
    const updateOneCall = db.collection("centralBanks").updateOne.mock.calls[0]!;
    expect(updateOneCall[1].$set.chairInfamy).toBe(15);
  });

  it("does not apply scrutiny for a normal cut within 0.75pp", async () => {
    await setup({ bank: makeMockBank({ primeRate: 3.0, chairInfamy: 5 }) });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ rate: 2.25 }), ctx()); // -0.75 cut (exactly at threshold)

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scrutinyApplied).toBe(false);
    const updateOneCall = db.collection("centralBanks").updateOne.mock.calls[0]!;
    expect(updateOneCall[1].$set.chairInfamy).toBeUndefined();
  });

  it("rejects cut exceeding 1.75pp", async () => {
    await setup({ bank: makeMockBank({ primeRate: 4.0 }) });
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const res = await POST(makeRequest({ rate: 2.0 }), ctx()); // -2.0 cut

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/1\.75%/);
    expect(sendMultiCountryGameEvent).not.toHaveBeenCalled();
  });

  it("caps scrutiny at 100 even if existing infamy is near the ceiling", async () => {
    await setup({ bank: makeMockBank({ primeRate: 4.0, chairInfamy: 95 }) });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ rate: 2.25 }), ctx()); // -1.75 cut

    expect(res.status).toBe(200);
    const updateOneCall = db.collection("centralBanks").updateOne.mock.calls[0]!;
    expect(updateOneCall[1].$set.chairInfamy).toBe(100); // capped
  });

  it("allows admin rate changes that exceed the 0.75% delta cap", async () => {
    const adminUser = makeMockUser({
      isAdmin: true,
      character: { _id: new ObjectId(), name: "Site Admin" },
    });
    await setup({ user: adminUser, bank: makeMockBank({ primeRate: 2.0 }) });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ rate: 5.0 }), ctx());

    expect(res.status).toBe(200);
  });

  it("rejects chair rate changes while on the 6-turn cooldown", async () => {
    await setup({ bank: makeMockBank({ primeRate: 2.0, lastRateChangeTurn: 97 }) });
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const res = await POST(makeRequest({ rate: 2.25 }), ctx());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/cooldown|every 6 turns|6 turns/i);
    expect(sendMultiCountryGameEvent).not.toHaveBeenCalled();
  });

  it("allows chair rate changes once the 6-turn cooldown elapses", async () => {
    await setup({ bank: makeMockBank({ primeRate: 2.0, lastRateChangeTurn: 94 }) });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ rate: 2.25 }), ctx());

    expect(res.status).toBe(200);
  });

  it("fans the rate-change webhook to shared-bank members (ECB → DE)", async () => {
    // ECB is DE's shared euro bank. IE has its own Central Bank of Ireland.
    await setup({ bank: makeMockBank({ _id: "ECB", countryId: "DE", primeRate: 2.0 }) });
    const { POST } = await import("./route");
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");

    const deCtx = { params: Promise.resolve({ code: "DE" }) };
    const req = new Request("http://localhost/api/country/DE/central-bank/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate: 1.75 }),
    });

    const res = await POST(req, deCtx);

    expect(res.status).toBe(200);
    expect(sendMultiCountryGameEvent).toHaveBeenCalledTimes(1);
    const [recipients] = vi.mocked(sendMultiCountryGameEvent).mock.calls[0]!;
    expect([...recipients].sort()).toEqual(["DE"]);
  });

  it("returns 200 even if webhook rejects — failure is fire-and-forget", async () => {
    await setup();
    const { sendMultiCountryGameEvent } = await import("@/lib/discordWebhooks");
    vi.mocked(sendMultiCountryGameEvent).mockRejectedValueOnce(new Error("Discord 503"));

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ rate: 2.25 }), ctx());

    expect(res.status).toBe(200);
    expect(sendMultiCountryGameEvent).toHaveBeenCalledTimes(1);
  });
});
