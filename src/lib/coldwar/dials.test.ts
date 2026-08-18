import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { getColdWarDials, PEACETIME_DIALS } from "./dials";
import {
  deriveVietnamDials,
  emptyVietnamState,
  VIETNAM_ESCALATION_COLLECTION,
  VIETNAM_ESCALATION_ID,
  VIETNAM_MAX_LEVEL,
  type VietnamEscalationState,
} from "@/lib/crises/vietnamEscalation";

function dbWithLadder(state: VietnamEscalationState | null) {
  return {
    collection(name: string) {
      return {
        async findOne(filter: { _id: string }) {
          if (name !== VIETNAM_ESCALATION_COLLECTION) return null;
          if (filter._id !== VIETNAM_ESCALATION_ID) return null;
          return state ? { _id: VIETNAM_ESCALATION_ID, ...state } : null;
        },
      };
    },
  } as unknown as Db;
}

function stateAt(level: number, over: Partial<VietnamEscalationState> = {}) {
  return { ...emptyVietnamState(), hasOpened: true, level, ...over };
}

describe("Cold War console dials", () => {
  it("reads peacetime when the world has never had a ladder", async () => {
    expect(await getColdWarDials(dbWithLadder(null))).toEqual(PEACETIME_DIALS);
  });

  it("reads peacetime when the ladder has been talked down to nothing", async () => {
    expect(await getColdWarDials(dbWithLadder(stateAt(0)))).toEqual(PEACETIME_DIALS);
  });

  it("labels peacetime values as such, so a calm reading is not ambiguous", async () => {
    const dials = await getColdWarDials(dbWithLadder(null));
    expect(dials.source).toBe("peacetime");
    expect(dials.defcon).toBe(5);
  });

  it("serves the ladder's derived dials once a war is on", async () => {
    const state = stateAt(VIETNAM_MAX_LEVEL, { warTurns: 12, westSupport: 40 });
    const dials = await getColdWarDials(dbWithLadder(state));
    const expected = deriveVietnamDials(state);

    expect(dials.source).toBe("vietnam");
    expect(dials.defcon).toBe(expected.defcon);
    expect(dials.cohesionWest).toBe(expected.cohesionWest);
    expect(dials.cohesionEast).toBe(expected.cohesionEast);
    expect(dials.warWeariness).toBe(expected.warWeariness);
    expect(dials.procurementMultiplier).toBe(expected.procurementMultiplier);
    expect(dials.detenteGoodwillPenalty).toBe(expected.detenteGoodwillPenalty);
  });

  it("drops readiness below peacetime as the war deepens", async () => {
    const low = await getColdWarDials(dbWithLadder(stateAt(1)));
    const high = await getColdWarDials(dbWithLadder(stateAt(VIETNAM_MAX_LEVEL)));
    expect(low.defcon).toBeLessThan(PEACETIME_DIALS.defcon);
    expect(high.defcon).toBeLessThan(low.defcon);
  });

  it("keeps every served value inside the console's expected ranges", async () => {
    for (let level = 0; level <= VIETNAM_MAX_LEVEL; level++) {
      const dials = await getColdWarDials(dbWithLadder(stateAt(level, { warTurns: 40 })));
      expect(dials.defcon).toBeGreaterThanOrEqual(1);
      expect(dials.defcon).toBeLessThanOrEqual(5);
      for (const value of [dials.cohesionWest, dials.cohesionEast, dials.warWeariness]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(dials.procurementMultiplier).toBeGreaterThanOrEqual(1);
    }
  });
});
