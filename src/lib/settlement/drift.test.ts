import { describe, expect, it } from "vitest";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import {
  DRIFT_K_PCT,
  DRIFT_NOISE_SPAN,
  HUNDREDTHS,
  SETTLEMENT_INSTITUTIONS,
} from "@/lib/constants/settlementCrisis";
import { driftSeedFor, rollInstitutionDrift, weightedDrift } from "./drift";

/** An rng stub returning a fixed value, so the noise term is controllable. */
const fixedRng = (v: number) => () => v;

const street = SETTLEMENT_INSTITUTIONS.find((i) => i.id === "street")!;

describe("rollInstitutionDrift", () => {
  it("is zero at the anchor with the noise term centred", () => {
    const drift = rollInstitutionDrift({
      institutionId: "street",
      position: street.anchor,
      rng: fixedRng(0.5),
    });
    expect(drift).toBe(0);
  });

  it("pulls back toward the anchor when pushed East", () => {
    const drift = rollInstitutionDrift({
      institutionId: "street",
      position: street.anchor + 20 * HUNDREDTHS,
      rng: fixedRng(0.5),
    });
    // k of 2000 hundredths, pulling back. Derived from the constant rather
    // than frozen at one tuning: a balance retune must not read as a failure.
    expect(drift).toBe(-(DRIFT_K_PCT * 20));
  });

  it("pulls back toward the anchor when pushed West", () => {
    const drift = rollInstitutionDrift({
      institutionId: "street",
      position: street.anchor - 20 * HUNDREDTHS,
      rng: fixedRng(0.5),
    });
    expect(drift).toBe(DRIFT_K_PCT * 20);
  });

  it("adds the noise band at its extremes", () => {
    const high = rollInstitutionDrift({
      institutionId: "street",
      position: street.anchor,
      rng: fixedRng(1),
    });
    const low = rollInstitutionDrift({
      institutionId: "street",
      position: street.anchor,
      rng: fixedRng(0),
    });
    expect(high).toBe(DRIFT_NOISE_SPAN);
    expect(low).toBe(-DRIFT_NOISE_SPAN);
  });

  it("returns an integer for any rng value", () => {
    const rng = makeSeededRng("settlement:drift:test");
    for (let n = 0; n < 50; n++) {
      const drift = rollInstitutionDrift({
        institutionId: "bundestag",
        position: 4137,
        rng,
      });
      expect(Number.isInteger(drift)).toBe(true);
    }
  });

  it("is deterministic for the same seed", () => {
    const run = () => {
      const rng = makeSeededRng(driftSeedFor(412));
      return SETTLEMENT_INSTITUTIONS.map((i) =>
        rollInstitutionDrift({ institutionId: i.id, position: i.opening, rng })
      );
    };
    expect(run()).toEqual(run());
  });

  it("differs between turns", () => {
    const at = (turn: number) => {
      const rng = makeSeededRng(driftSeedFor(turn));
      return SETTLEMENT_INSTITUTIONS.map((i) =>
        rollInstitutionDrift({ institutionId: i.id, position: i.opening, rng })
      );
    };
    expect(at(412)).not.toEqual(at(413));
  });

  it("treats an unknown institution as anchorless and drifts only on noise", () => {
    const drift = rollInstitutionDrift({
      institutionId: "nonesuch",
      position: 5000,
      rng: fixedRng(0.5),
    });
    expect(drift).toBe(0);
  });

  it("advances the rng even for an unknown institution, so later rolls stay in step", () => {
    // If the anchor lookup returned before drawing, one bad id would shift every
    // subsequent institution's roll and break replay.
    const withUnknown = makeSeededRng("parity");
    rollInstitutionDrift({ institutionId: "nonesuch", position: 5000, rng: withUnknown });
    const afterUnknown = rollInstitutionDrift({
      institutionId: "street",
      position: street.anchor,
      rng: withUnknown,
    });

    const withKnown = makeSeededRng("parity");
    rollInstitutionDrift({ institutionId: "street", position: street.anchor, rng: withKnown });
    const afterKnown = rollInstitutionDrift({
      institutionId: "street",
      position: street.anchor,
      rng: withKnown,
    });

    expect(afterUnknown).toBe(afterKnown);
  });
});

describe("weightedDrift", () => {
  it("reports the drift the index actually moved by", () => {
    const rolls = [
      { weight: 3, drift: 180 },
      { weight: 2, drift: -60 },
      { weight: 2, drift: 310 },
      { weight: 3, drift: 0 },
    ];
    // (3*180 + 2*-60 + 2*310 + 3*0) / 10 = (540 - 120 + 620) / 10 = 104
    expect(weightedDrift(rolls)).toBe(104);
  });

  it("returns zero for an empty list", () => {
    expect(weightedDrift([])).toBe(0);
  });
});
