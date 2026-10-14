import { describe, expect, it, vi, afterEach } from "vitest";
import { abandonSectorRequest, bankImpactWarning } from "./abandonSectorClient";

const impact = {
  ceilingBefore: 25_000_000,
  ceilingAfter: 0,
  lastFinancialSector: true,
  deposits: 28_860_000,
};
const reply = (status: number, body: unknown) => ({
  ok: status < 300,
  status,
  json: async () => body,
});

afterEach(() => vi.unstubAllGlobals());

describe("abandonSectorRequest", () => {
  it("shows the bank impact and retries with the acknowledgement only after the player confirms", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(409, {
          code: "BANK_CAPACITY_IMPACT",
          error: "This is your last financial sector.",
          bankImpact: impact,
        })
      )
      .mockResolvedValueOnce(reply(200, { success: true, message: "Abandoned" }));
    vi.stubGlobal("fetch", fetchMock);
    const seen: string[] = [];
    const r = await abandonSectorRequest("823", "s1", (text) => {
      seen.push(text);
      return true;
    });
    expect(r.ok).toBe(true);
    expect(seen[0]).toContain("$25,000,000 now, $0 after");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ acknowledgeBankImpact: true });
  });

  it("stops when the player declines", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(409, { code: "BANK_CAPACITY_IMPACT", error: "x", bankImpact: impact })
      );
    vi.stubGlobal("fetch", fetchMock);
    const r = await abandonSectorRequest("823", "s1", () => false);
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("formats the warning with both ceilings and the deposits held", () => {
    expect(bankImpactWarning("msg", impact)).toMatch(
      /Deposit ceiling: \$25,000,000 now, \$0 after\.\nDeposits held: \$28,860,000\./
    );
  });
});
