import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(120) }));
vi.mock("@/lib/banking/policy", () => ({ loadBankingPolicy: vi.fn() }));
vi.mock("@/lib/banking/health", () => ({ buildBankingHealth: vi.fn() }));

let db: MockDb;

function health(overrides: Record<string, unknown> = {}) {
  return {
    gate: { ok: true, reasons: [] },
    savingsAccounts: {
      mode: "shadow",
      readCurrencies: [],
      comparison: {
        turn: 120,
        currencies: [
          {
            currency: "USD",
            legacyOwnerTotal: 1_000,
            accountOwnerTotal: 1_000,
            rowDiscrepancies: 0,
            discrepancies: 0,
          },
        ],
      },
    },
    ...overrides,
  };
}

async function setup(policy: Record<string, unknown>, report = health()) {
  db = createMockDb();
  db.collection("gameConfig");
  const { getDb } = await import("@/lib/mongodb");
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  const { loadBankingPolicy } = await import("@/lib/banking/policy");
  const { buildBankingHealth } = await import("@/lib/banking/health");
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { userId: "admin", username: "admin", isAdmin: true },
  } as never);
  vi.mocked(loadBankingPolicy).mockResolvedValue({
    privateBanking: true,
    propTrading: true,
    contagion: true,
    lineOfCredit: true,
    advancedCharters: true,
    savingsAccounts: "shadow",
    savingsReadCurrencies: [],
    ...policy,
  } as never);
  vi.mocked(buildBankingHealth).mockResolvedValue(report as never);
}

function post(body: unknown) {
  return new Request("http://localhost/api/admin/banking/rollout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/banking/rollout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-admin", async () => {
    await setup({});
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(403);
  });

  it("reports every change decided in advance, with reasons on the refused ones", async () => {
    await setup({ savingsAccounts: "shadow" });
    const { GET } = await import("./route");
    const body = (await (await GET()).json()) as {
      state: { mode: string; readCurrencies: string[] };
      decisions: Array<{
        change: { kind: string; mode?: string; currency?: string };
        allowed: boolean;
        reasons: string[];
      }>;
    };
    expect(body.state).toEqual({ mode: "shadow", readCurrencies: [] });
    const toAuthoritative = body.decisions.find(
      (d) => d.change.kind === "mode" && d.change.mode === "authoritative"
    )!;
    expect(toAuthoritative.allowed).toBe(true);
    const addUsd = body.decisions.find((d) => d.change.currency === "USD")!;
    expect(addUsd.allowed).toBe(false);
    expect(addUsd.reasons.join(" ")).toMatch(/authoritative mode only/);
  });

  it("applies an allowed widening and writes the config", async () => {
    await setup({ savingsAccounts: "shadow" });
    const { POST } = await import("./route");
    const res = await POST(post({ kind: "mode", mode: "authoritative" }));
    expect(res.status).toBe(200);
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      { $set: { savingsAccountsMode: "authoritative", savingsAccountsReadCurrencies: [] } },
      { upsert: true }
    );
    const { createAdminLog } = await import("@/lib/adminLog");
    expect(vi.mocked(createAdminLog).mock.calls[0][0]).toMatchObject({
      action: "savings_rollout_widened",
    });
  });

  it("refuses a widening the rules refuse, with the reasons, and writes nothing", async () => {
    await setup(
      { savingsAccounts: "shadow" },
      health({
        gate: {
          ok: false,
          reasons: ["1 estate(s) claimed on earlier turns are still in resolution"],
        },
      })
    );
    const { POST } = await import("./route");
    const res = await POST(post({ kind: "mode", mode: "authoritative" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reasons: string[] };
    expect(body.reasons.join(" ")).toMatch(/Gate closed/);
    expect(db.collectionMocks.gameConfig!.updateOne).not.toHaveBeenCalled();
  });

  it("always applies a rollback, clearing the cohort below authoritative", async () => {
    await setup(
      { savingsAccounts: "authoritative", savingsReadCurrencies: ["USD"] },
      health({
        gate: {
          ok: false,
          reasons: ["2 settlement(s) from earlier turns are unfinished (oldest x)"],
        },
      })
    );
    const { POST } = await import("./route");
    const res = await POST(post({ kind: "mode", mode: "shadow" }));
    expect(res.status).toBe(200);
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      { $set: { savingsAccountsMode: "shadow", savingsAccountsReadCurrencies: [] } },
      { upsert: true }
    );
  });

  it("rejects an unknown currency", async () => {
    await setup({ savingsAccounts: "authoritative" });
    const { POST } = await import("./route");
    const res = await POST(post({ kind: "add_read_currency", currency: "ZZZ" }));
    expect(res.status).toBe(400);
  });
});
