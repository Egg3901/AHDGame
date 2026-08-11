import { describe, expect, it } from "vitest";
import { transition } from "./hysteresis";
import {
  ECONOMIC_MODEL_IDS,
  SWITCH_MARGIN,
  SWITCH_TURNS,
  DOMINANCE_FLOOR,
  type EconomicModelId,
} from "@/lib/constants/economicModels";

/** Build a full scores record from a sparse map (others 0). */
function scoresOf(
  sparse: Partial<Record<EconomicModelId, number>>
): Record<EconomicModelId, number> {
  const out = {} as Record<EconomicModelId, number>;
  for (const id of ECONOMIC_MODEL_IDS) out[id] = sparse[id] ?? 0;
  return out;
}

const INC = "socialMarket"; // incumbent
const CH = "techInnovation"; // challenger
const OTHER = "financialized"; // a different challenger

describe("hysteresis transition", () => {
  it("falls to mixed when the leader is below the dominance floor", () => {
    const out = transition(
      { current: INC, challenger: { modelId: CH, turnsLeading: 10 } },
      INC,
      scoresOf({ [INC]: DOMINANCE_FLOOR - 1 })
    );
    expect(out.current).toBe("mixed");
    expect(out.challenger).toBeUndefined();
  });

  it("a challenger leading by < margin never accrues toward a flip", () => {
    let state = { current: INC } as Parameters<typeof transition>[0];
    for (let i = 0; i < SWITCH_TURNS + 5; i++) {
      // leader is the challenger but only +1 over incumbent (< SWITCH_MARGIN)
      state = transition(state, CH, scoresOf({ [INC]: 60, [CH]: 61 }));
    }
    expect(state.current).toBe(INC); // never flipped
  });

  it("flips only after a sustained ≥-margin lead for SWITCH_TURNS turns (47 no, 48 yes)", () => {
    const scores = scoresOf({ [INC]: 60, [CH]: 60 + SWITCH_MARGIN });
    let state = { current: INC } as Parameters<typeof transition>[0];
    for (let i = 0; i < SWITCH_TURNS - 1; i++) state = transition(state, CH, scores);
    expect(state.current).toBe(INC); // 47 turns → not yet
    state = transition(state, CH, scores);
    expect(state.current).toBe(CH); // 48th turn → flip
    expect(state.challenger).toBeUndefined();
  });

  it("DECAYS (does not reset) progress on a brief sub-margin dip", () => {
    const dip = transition(
      { current: INC, challenger: { modelId: CH, turnsLeading: 40 } },
      CH, // still the leader, but…
      scoresOf({ [INC]: 60, [CH]: 61 }) // …only +1 (< margin) this turn
    );
    expect(dip.challenger?.modelId).toBe(CH);
    expect(dip.challenger?.turnsLeading).toBe(39); // 40 − GRACE_DECAY, NOT reset to 0/1
  });

  it("starts a FRESH counter when a different model takes the lead", () => {
    const out = transition(
      { current: INC, challenger: { modelId: CH, turnsLeading: 40 } },
      OTHER,
      scoresOf({ [INC]: 60, [OTHER]: 60 + SWITCH_MARGIN })
    );
    expect(out.challenger?.modelId).toBe(OTHER);
    expect(out.challenger?.turnsLeading).toBe(1); // fresh identity → 0 then accrued once
  });

  it("drains to 0 and clears the challenger on a sustained loss of lead", () => {
    let state = { current: INC, challenger: { modelId: CH, turnsLeading: 2 } } as Parameters<
      typeof transition
    >[0];
    state = transition(state, CH, scoresOf({ [INC]: 60, [CH]: 61 })); // dip → 1
    expect(state.challenger?.turnsLeading).toBe(1);
    state = transition(state, CH, scoresOf({ [INC]: 60, [CH]: 61 })); // dip → 0 → cleared
    expect(state.current).toBe(INC);
    expect(state.challenger).toBeUndefined();
  });

  it("decays the challenger when the incumbent retakes the lead", () => {
    const out = transition(
      { current: INC, challenger: { modelId: CH, turnsLeading: 3 } },
      INC, // incumbent back on top
      scoresOf({ [INC]: 70, [CH]: 50 })
    );
    expect(out.current).toBe(INC);
    expect(out.challenger?.turnsLeading).toBe(2); // decayed
  });
});
