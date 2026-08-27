import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { processColdWarTensionTurn } from "./coldWarTensionTurn";
import { runTensionTurn } from "@/lib/coldwar/tension";
import { readStandingPressureSnapshot } from "@/lib/coldwar/standingPressure";

vi.mock("@/lib/coldwar/standingPressure", () => ({ readStandingPressureSnapshot: vi.fn() }));
vi.mock("@/lib/coldwar/tension", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/coldwar/tension")>();
  return { ...actual, runTensionTurn: vi.fn() };
});

describe("processColdWarTensionTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readStandingPressureSnapshot).mockResolvedValue({
      totalWarheads: 1214,
      warSummary: {
        nuclearWarIntensity: 70,
        otherWarIntensity: 0,
        activeWarCount: 1,
        nuclearWarCount: 1,
      },
      pressures: {
        escalationLevel: 1,
        activeCrises: 6,
        totalWarheads: 1214,
        nuclearWarIntensity: 70,
        nuclearWarCount: 1,
        otherWarIntensity: 0,
      },
    });
    vi.mocked(runTensionTurn).mockResolvedValue({ value: 68.5 } as never);
  });

  it("runs the turn from the shared live standing-pressure snapshot", async () => {
    const db = createMockDb();
    const gameState = { coldWarEnabled: true, livingConflictsEnabled: false };

    await processColdWarTensionTurn(db as unknown as Db, 436, gameState);

    expect(readStandingPressureSnapshot).toHaveBeenCalledWith(db, gameState);
    expect(runTensionTurn).toHaveBeenCalledWith(db, 436, {
      escalationLevel: 1,
      activeCrises: 6,
      totalWarheads: 1214,
      nuclearWarIntensity: 70,
      nuclearWarCount: 1,
      otherWarIntensity: 0,
    });
  });
});
