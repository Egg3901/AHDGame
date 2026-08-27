import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { processColdWarTensionTurn } from "./coldWarTensionTurn";
import { getVietnamEscalation } from "@/lib/crises/vietnamEscalation";
import { listNuclearPrograms } from "@/lib/db/collections/nuclearPrograms";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { runTensionTurn } from "@/lib/coldwar/tension";

vi.mock("@/lib/crises/vietnamEscalation", () => ({ getVietnamEscalation: vi.fn() }));
vi.mock("@/lib/livingConflict/vietnamCompat", () => ({ livingVietnamAsLegacyState: vi.fn() }));
vi.mock("@/lib/db/collections/nuclearPrograms", () => ({ listNuclearPrograms: vi.fn() }));
vi.mock("@/lib/db/collections/conflicts", () => ({ listActiveConflicts: vi.fn() }));
vi.mock("@/lib/coldwar/tension", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/coldwar/tension")>();
  return { ...actual, runTensionTurn: vi.fn() };
});

describe("processColdWarTensionTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVietnamEscalation).mockResolvedValue({ level: 1 } as never);
    vi.mocked(listNuclearPrograms).mockResolvedValue([
      { _id: "US", warheads: 522 },
      { _id: "RU", warheads: 114 },
      { _id: "UK", warheads: 578 },
    ] as never);
    vi.mocked(listActiveConflicts).mockResolvedValue([
      {
        sideA: { countries: ["US"] },
        sideB: { countries: ["DD", "RU"] },
        intensity: 70,
      },
    ] as never);
    vi.mocked(runTensionTurn).mockResolvedValue({ value: 68.5 } as never);
  });

  it("keeps Vietnam separate and adds the live nuclear war to standing pressure", async () => {
    const db = createMockDb();
    db.collection("crises");
    db.collectionMocks.crises!.countDocuments.mockResolvedValue(1);

    await processColdWarTensionTurn(db as unknown as Db, 436, {
      coldWarEnabled: true,
      livingConflictsEnabled: false,
    });

    expect(db.collectionMocks.crises!.countDocuments).toHaveBeenCalledWith({
      status: "active",
      globalResponse: { $exists: true },
    });
    expect(runTensionTurn).toHaveBeenCalledWith(db, 436, {
      escalationLevel: 1,
      activeCrises: 1,
      totalWarheads: 1214,
      nuclearWarIntensity: 70,
      otherWarIntensity: 0,
    });
  });
});
