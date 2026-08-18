import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  driftStanceAxis,
  nppDriftStep,
  processNppStanceDrift,
  NPP_STANCE_DRIFT_INTERVAL,
  NPP_STANCE_DRIFT_MAX_STEP,
} from "./nppStanceDrift";

describe("NPP stance drift math (#101)", () => {
  it("nppDriftStep: fully mobile at stubbornness 0, immovable at 100", () => {
    expect(nppDriftStep(0)).toBeCloseTo(NPP_STANCE_DRIFT_MAX_STEP, 10);
    expect(nppDriftStep(100)).toBe(0);
    expect(nppDriftStep(50)).toBeCloseTo(NPP_STANCE_DRIFT_MAX_STEP / 2, 10);
  });

  it("driftStanceAxis: nudges toward target by at most step, without overshooting", () => {
    expect(driftStanceAxis(0, 3, 0.3)).toBeCloseTo(0.3, 10);
    expect(driftStanceAxis(0, -3, 0.3)).toBeCloseTo(-0.3, 10);
    // Within a step of the target → lands exactly on it, no overshoot.
    expect(driftStanceAxis(2.9, 3, 0.3)).toBe(3);
    // No movement when already at target.
    expect(driftStanceAxis(1.2, 1.2, 0.3)).toBe(1.2);
  });

  it("driftStanceAxis: clamps to the [-5, 5] stance range", () => {
    expect(driftStanceAxis(4.9, 10, 0.3)).toBe(5);
    expect(driftStanceAxis(-4.9, -10, 0.3)).toBe(-5);
  });
});

function cursor<T>(rows: T[]) {
  return { toArray: vi.fn().mockResolvedValue(rows) };
}

describe("processNppStanceDrift phase (#101)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("npps");
    db.collection("states");
    db.collection("legislationTypes");
    db.collectionMocks.legislationTypes.find.mockReturnValue(cursor([])); // no domain types
  });

  // Pinned, not random. The drift target is `party + leanPull * (stateLean -
  // party)` plus `nppIdiosyncrasy(id, axis)`, a +/-0.8 offset FNV-hashed from
  // the id. A fresh ObjectId therefore moved the target every run: on the
  // social axis (anchor -0.7) it landed inside one 0.3 step often enough to
  // fail roughly a quarter of runs. See stanceTarget.ts.
  const nppId = new ObjectId("0123456789abcdef01234567");
  function seedOneNpp(stubbornness: number, econ = 0, social = 0) {
    db.collectionMocks.npps.find.mockReturnValue(
      cursor([
        {
          _id: nppId,
          homeState: "CA",
          policies: { economic: econ, social, domainPositions: {} },
          personality: { loyalty: 50, ambition: 50, stubbornness },
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "CA", cachedEconomicLean: -3, cachedSocialLean: -2 }])
    );
  }

  it("no-ops except on the drift interval", async () => {
    seedOneNpp(0);
    const res = await processNppStanceDrift(db as unknown as Db, NPP_STANCE_DRIFT_INTERVAL + 1);
    expect(res.drifted).toBe(0);
    expect(db.collectionMocks.npps.bulkWrite).not.toHaveBeenCalled();
  });

  it("drifts a mobile NPP's stance toward its party-anchored target", async () => {
    seedOneNpp(0, 0, 0); // fully mobile, starts at (0,0); CA lean is (-3,-2)
    const res = await processNppStanceDrift(db as unknown as Db, NPP_STANCE_DRIFT_INTERVAL);
    expect(res.drifted).toBe(1);
    const op = db.collectionMocks.npps.bulkWrite.mock.calls[0][0][0];
    // Party-less NPP, so the anchor is 0 pulled 35% toward the CA lean. For the
    // pinned id both axis targets sit beyond one step (-1.6 econ, -1.1 social),
    // so both move the full MAX_STEP left. This is NOT the state lean itself:
    // the NPP stops well short of it, which is the point of the party anchor.
    expect(op.updateOne.update.$set["policies.economic"]).toBeCloseTo(
      -NPP_STANCE_DRIFT_MAX_STEP,
      10
    );
    expect(op.updateOne.update.$set["policies.social"]).toBeCloseTo(-NPP_STANCE_DRIFT_MAX_STEP, 10);
  });

  it("does not move a fully stubborn NPP", async () => {
    seedOneNpp(100, 0, 0);
    const res = await processNppStanceDrift(db as unknown as Db, NPP_STANCE_DRIFT_INTERVAL);
    expect(res.drifted).toBe(0);
    expect(db.collectionMocks.npps.bulkWrite).not.toHaveBeenCalled();
  });
});
