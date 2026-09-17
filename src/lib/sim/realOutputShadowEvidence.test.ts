import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  buildRealOutputShadowEvidence,
  classifyRealOutputShadowRegion,
  collectRealOutputShadowEvidence,
} from "./realOutputShadowEvidence";

describe("classifyRealOutputShadowRegion (explicit missing/cold-start semantics)", () => {
  it("is missing without a persisted baseline", () => {
    expect(classifyRealOutputShadowRegion({})).toBe("missing");
    expect(classifyRealOutputShadowRegion({ units: 450 })).toBe("missing");
    expect(classifyRealOutputShadowRegion({ turn: 10 })).toBe("missing");
    expect(classifyRealOutputShadowRegion({ units: NaN, turn: 10 })).toBe("missing");
  });

  it("is cold-start with a baseline but no print", () => {
    expect(classifyRealOutputShadowRegion({ units: 450, turn: 10, growth: null })).toBe(
      "cold-start"
    );
    expect(classifyRealOutputShadowRegion({ units: 450, turn: 10 })).toBe("cold-start");
    expect(classifyRealOutputShadowRegion({ units: 450, turn: 10, growth: NaN })).toBe(
      "cold-start"
    );
  });

  it("is ready only with a finite print", () => {
    expect(classifyRealOutputShadowRegion({ units: 450, turn: 10, growth: 0 })).toBe("ready");
    expect(classifyRealOutputShadowRegion({ units: 450, turn: 10, growth: -10 })).toBe("ready");
  });
});

describe("buildRealOutputShadowEvidence (control/treatment comparison)", () => {
  it("returns null for the control (flag off): no shadow section at all", () => {
    expect(
      buildRealOutputShadowEvidence({
        flagEnabled: false,
        turn: 10,
        states: [],
        nominalByStateId: {},
      })
    ).toBeNull();
  });

  it("pairs nominal beside shadow with divergence on ready regions", () => {
    const out = buildRealOutputShadowEvidence({
      flagEnabled: true,
      turn: 10,
      states: [
        {
          _id: "s1",
          countryId: "US",
          sectorRealOutputUnits: 1010,
          sectorRealOutputUnitsTurn: 10,
          sectorRealOutputShadowGrowth: 2,
        },
      ],
      nominalByStateId: { s1: -10 },
    })!;
    expect(out.flagEnabled).toBe(true);
    expect(out.turn).toBe(10);
    expect(out.ready).toBe(1);
    expect(out.coldStart).toBe(0);
    expect(out.missing).toBe(0);
    expect(out.regions).toEqual([
      {
        stateId: "s1",
        countryId: "US",
        nominalSectorGrowth: -10,
        shadowGrowth: 2,
        divergence: -12,
        shadowUnits: 1010,
        shadowTurn: 10,
        status: "ready",
      },
    ]);
  });

  it("counts cold-start and missing separately and never invents a divergence", () => {
    const out = buildRealOutputShadowEvidence({
      flagEnabled: true,
      turn: 10,
      states: [
        {
          _id: "s1",
          countryId: "US",
          sectorRealOutputUnits: 450,
          sectorRealOutputUnitsTurn: 10,
          sectorRealOutputShadowGrowth: null,
        },
        { _id: "s2", countryId: "US" },
      ],
      nominalByStateId: { s1: 3 },
    })!;
    expect(out.ready).toBe(0);
    expect(out.coldStart).toBe(1);
    expect(out.missing).toBe(1);
    expect(out.regions[0]).toMatchObject({ stateId: "s1", status: "cold-start", divergence: null });
    expect(out.regions[1]).toMatchObject({
      stateId: "s2",
      status: "missing",
      shadowGrowth: null,
      divergence: null,
    });
  });

  it("treats a missing nominal leg as null divergence, not zero", () => {
    const out = buildRealOutputShadowEvidence({
      flagEnabled: true,
      turn: 10,
      states: [
        {
          _id: "s1",
          countryId: "US",
          sectorRealOutputUnits: 450,
          sectorRealOutputUnitsTurn: 10,
          sectorRealOutputShadowGrowth: 1,
        },
      ],
      nominalByStateId: {},
    })!;
    expect(out.regions[0]).toMatchObject({
      nominalSectorGrowth: null,
      shadowGrowth: 1,
      divergence: null,
      status: "ready",
    });
  });

  it("excludes national-scope synthetic docs and sorts by stateId", () => {
    const out = buildRealOutputShadowEvidence({
      flagEnabled: true,
      turn: 10,
      states: [
        { _id: "s-b", countryId: "US" },
        { _id: "federal", countryId: "US" },
        { _id: "s-a", countryId: "US" },
      ],
      nominalByStateId: new Map(),
    })!;
    expect(out.regions.map((r) => r.stateId)).toEqual(["s-a", "s-b"]);
    expect(out.missing).toBe(2);
  });
});

describe("collectRealOutputShadowEvidence (reporting shell)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function setupFind<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
      toArray: vi.fn().mockResolvedValue(data),
    });
  }

  it("returns null when the flag is off: three reads at most, no shadow section", async () => {
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "default", realOutputShadowEnabled: false });
    setupFind("states", []);
    const out = await collectRealOutputShadowEvidence(db as unknown as Db, 10);
    expect(out).toBeNull();
  });

  it("collects per-region evidence flag-on with batched reads only", async () => {
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "default", realOutputShadowEnabled: true });
    setupFind("states", [
      {
        _id: "s1",
        countryId: "US",
        sectorRealOutputUnits: 1010,
        sectorRealOutputUnitsTurn: 10,
        sectorRealOutputShadowGrowth: 2,
      },
    ]);
    setupFind("macroMetrics", [{ _id: "s1", economic: { sectorGrowth: { value: -10 } } }]);
    const out = (await collectRealOutputShadowEvidence(db as unknown as Db, 10))!;
    expect(out.turn).toBe(10);
    expect(out.ready).toBe(1);
    expect(out.regions[0]).toMatchObject({
      stateId: "s1",
      nominalSectorGrowth: -10,
      shadowGrowth: 2,
      divergence: -12,
      status: "ready",
    });
    expect(db.collectionMocks.states!.find).toHaveBeenCalledTimes(1);
  });
});
