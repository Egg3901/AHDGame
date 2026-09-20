import { describe, expect, it } from "vitest";
import type { LivingConflictState } from "@/lib/livingConflict/types";
import { summarizeLivingConflicts } from "./metrics";

function conflict(seed: Partial<LivingConflictState> & Pick<LivingConflictState, "defKey">) {
  return {
    hasOpened: false,
    status: "dormant",
    phaseLevel: 1,
    intensity: 0,
    openedYear: null,
    pressure: {},
    tracks: {},
    phaseTurns: 0,
    totalTurns: 0,
    updatedAt: new Date(0),
    ...seed,
  } as LivingConflictState;
}

describe("living-conflict worldsim metrics", () => {
  it("reports timing, overlap, decisions, tracks, damage, displacement, and recovery", () => {
    const result = summarizeLivingConflicts(
      [
        conflict({
          defKey: "northern_ireland",
          hasOpened: true,
          status: "settled",
          phaseLevel: 5,
          openedYear: 1991,
          totalTurns: 300,
          tracks: { violence: 12, reconstruction: 55 },
          campaign: {
            stage: "aftermath",
            stageTurns: 12,
            cycle: 2,
            consequences: {
              civilianStrain: 4,
              refugees: 2,
              infrastructureDamage: 8,
              armsProliferation: 1,
              regionalSpillover: 3,
              casualties: 5,
              settlementMomentum: 78,
            },
            countryMemory: {},
          },
        }),
        conflict({
          defKey: "pandemic",
          hasOpened: true,
          status: "active",
          phaseLevel: 3,
          openedYear: 2019,
          totalTurns: 30,
          tracks: { transmission: 74, immunity: 18 },
        }),
        conflict({ defKey: "future", status: undefined }),
      ],
      4,
      19
    );

    expect(result).toMatchObject({
      total: 3,
      opened: 2,
      byStatus: { active: 1, settled: 1, dormant: 1 },
      pendingDecisions: 4,
      resolvedDecisions: 19,
    });
    expect(result.byDefinition.map((row) => row.defKey)).toEqual([
      "future",
      "northern_ireland",
      "pandemic",
    ]);
    expect(result.byDefinition[1]).toMatchObject({
      openedYear: 1991,
      tracks: { violence: 12, reconstruction: 55 },
      consequences: { refugees: 2, infrastructureDamage: 8, settlementMomentum: 78 },
    });
  });
});
