import { describe, it, expect, vi, beforeEach } from "vitest";

const recordAudit = vi.fn();
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));

import { withAudit } from "./withAudit";

describe("withAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records outcome:ok and returns the result on success", async () => {
    const result = await withAudit("party.join", "party", async () => ({ partyId: "p1" }), {
      subject: { type: "party", id: "p1" },
    });

    expect(result).toEqual({ partyId: "p1" });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "party.join",
        category: "party",
        outcome: "ok",
        subject: { type: "party", id: "p1" },
      })
    );
  });

  it("derives the envelope from the resolved result when given a function", async () => {
    await withAudit(
      "corp.found",
      "corp",
      async () => ({ corporationId: "c1" }),
      (result) => ({ subject: { type: "corporation", id: result.corporationId } })
    );

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "corp.found",
        subject: { type: "corporation", id: "c1" },
        outcome: "ok",
      })
    );
  });

  it("records outcome:error with the failure reason and rethrows", async () => {
    const boom = new Error("insufficient funds");

    await expect(
      withAudit("corp.dissolve", "corp", async () => {
        throw boom;
      })
    ).rejects.toThrow("insufficient funds");

    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "corp.dissolve",
        category: "corp",
        outcome: "error",
        reason: "insufficient funds",
      })
    );
  });

  it("stringifies non-Error throws for the reason field", async () => {
    await expect(
      withAudit("party.donate", "party", async () => {
        throw "not an Error instance";
      })
    ).rejects.toBe("not an Error instance");

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "error", reason: "not an Error instance" })
    );
  });

  it("falls back to a default subject when none is supplied", async () => {
    await withAudit("character.rest", "character", async () => "ok");

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ subject: { type: "unknown" } })
    );
  });
});
