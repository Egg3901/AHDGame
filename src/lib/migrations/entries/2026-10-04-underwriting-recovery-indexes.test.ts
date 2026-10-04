import { describe, expect, it, vi } from "vitest";
import { migration } from "./2026-10-04-underwriting-recovery-indexes";
import { MIGRATIONS } from "../registry";

describe("underwriting recovery indexes", () => {
  it("is registered for startup and bootstrap migration runs", () => {
    expect(MIGRATIONS).toContain(migration);
  });

  it("previews without writes and installs sparse recovery indexes", async () => {
    const createIndex = vi.fn().mockResolvedValue("index");
    const db = { collection: vi.fn(() => ({ createIndex })) };
    await migration.execute(db as never, { dryRun: true } as never);
    expect(createIndex).not.toHaveBeenCalled();

    await migration.execute(db as never, { dryRun: false } as never);
    expect(createIndex.mock.calls).toEqual([
      [
        { "bankUnderwritingFunding.turn": 1 },
        { name: "corporations_underwriting_funding_turn", sparse: true },
      ],
      [
        { "foundingIpoUnderwritingPending.offer.instrumentId": 1 },
        { name: "corporations_founding_ipo_underwriting_instrument", sparse: true },
      ],
    ]);
  });
});
