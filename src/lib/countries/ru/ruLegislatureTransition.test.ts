import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), seating: vi.fn() }));
vi.mock("@/lib/db/runRequiredTransaction", () => ({ runRequiredTransaction: mocks.transaction }));
vi.mock("./assemblySeating", () => ({ materializeRussianAssemblySeating: mocks.seating }));
import { processRuLegislatureTransition } from "./ruLegislatureTransition";
const NOW = new Date("2026-01-01T00:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((body) => body("active-session"));
});
describe("Russian 1993 legislature transition", () => {
  it("does not advance during founding or before January eligibility", async () => {
    const db = { collection: vi.fn() } as unknown as Db;
    expect(await processRuLegislatureTransition(db, { preset: "1979-default" }, 145, NOW)).toBe(
      "none"
    );
    expect(
      await processRuLegislatureTransition(
        db,
        { preset: "1991-default", preIteration: { active: true, startedTurn: 1 } },
        200,
        NOW
      )
    ).toBe("none");
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 141, NOW)).toBe(
      "none"
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("delegates qualified handover to one required transaction using the connected client", async () => {
    const db = {
      client: "owned-client",
      collection: () => ({
        findOne: async () => ({
          ruFirstDumaElectionCohortId: "duma",
          ruFirstCouncilElectionCohortId: "council",
          ruSovietSuccessionSinceTurn: 48,
          ruFederalAssemblyMandateSinceTurn: 129,
        }),
      }),
    } as unknown as Db;
    mocks.seating.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 145, NOW)).toBe(
      "federalAssembly"
    );
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      client: "owned-client",
    });
    expect(mocks.seating).toHaveBeenCalledWith({
      db,
      session: "active-session",
      turn: 145,
      now: NOW,
    });
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 146, NOW)).toBe(
      "none"
    );
  });
  it("preserves legacy marker-only worlds without opening a transaction", async () => {
    const db = {
      collection: () => ({
        findOne: async () => ({
          ruSovietSuccessionSinceTurn: 48,
          ruFederalAssemblyMandateSinceTurn: 129,
          ruFederalAssemblyElectionCertifiedSinceTurn: 141,
        }),
      }),
    } as unknown as Db;
    expect(await processRuLegislatureTransition(db, { preset: "1991-default" }, 145, NOW)).toBe(
      "none"
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("propagates failure instead of reporting an uncommitted handover", async () => {
    mocks.seating.mockRejectedValueOnce(new Error("late receipt rejected"));
    await expect(
      processRuLegislatureTransition(
        {
          collection: () => ({
            findOne: async () => ({
              ruFirstDumaElectionCohortId: "duma",
              ruFirstCouncilElectionCohortId: "council",
              ruSovietSuccessionSinceTurn: 48,
              ruFederalAssemblyMandateSinceTurn: 129,
            }),
          }),
        } as unknown as Db,
        { preset: "1991-default" },
        145,
        NOW
      )
    ).rejects.toThrow("late receipt rejected");
  });
});
