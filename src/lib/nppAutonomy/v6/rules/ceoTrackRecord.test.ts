import { describe, expect, it } from "vitest";
import {
  applyCeoSample,
  CEO_RECORD_CADENCE_TURNS,
  CEO_RECORD_MAX_TURNS,
  CEO_RECORD_MIN_TURNS,
  CEO_RECORD_REL_CLAMP_PP,
  ceoRecordScore,
  computeCeoSamples,
  hasGoodCeoRecord,
  isCeoRecordTurn,
  sectorOperatingMarginPct,
  type CeoRecordSector,
} from "./ceoTrackRecord";

const sector = (
  corp: string,
  margin: number,
  extra: Partial<CeoRecordSector> = {}
): CeoRecordSector => ({
  corporationId: corp,
  countryId: "US",
  sectorType: "energy",
  revenue: 100,
  profitMargin: 35,
  effectiveProfitMargin: margin,
  ...extra,
});

describe("NPP engine 6 CEO track record", () => {
  it("samples once a game day", () => {
    expect(isCeoRecordTurn(0)).toBe(false);
    expect(isCeoRecordTurn(CEO_RECORD_CADENCE_TURNS)).toBe(true);
    expect(isCeoRecordTurn(CEO_RECORD_CADENCE_TURNS + 1)).toBe(false);
  });

  it("reads the physical net margin first, then the applied margin, and skips idle sectors", () => {
    expect(sectorOperatingMarginPct(sector("a", 30))).toBe(30);
    expect(
      sectorOperatingMarginPct(sector("a", 30, { plantsPnl: { revenue: 200, profit: -20 } }))
    ).toBe(-10);
    expect(sectorOperatingMarginPct(sector("a", 30, { mothballed: true }))).toBeNull();
    expect(sectorOperatingMarginPct(sector("a", 30, { revenue: 0 }))).toBeNull();
    expect(sectorOperatingMarginPct(sector("a", -5000))).toBe(-100);
  });

  it("scores an NPP CEO against other companies in the same country and lane", () => {
    const sectorsByCorp = new Map([
      ["npp-corp", [sector("npp-corp", 30), sector("npp-corp", 20, { sectorType: "financial" })]],
      ["peer-1", [sector("peer-1", 20)]],
      ["peer-2", [sector("peer-2", 10)]],
      ["abroad", [sector("abroad", 90, { countryId: "UK" })]],
    ]);
    const samples = computeCeoSamples(
      [
        { _id: "npp-corp", ceoType: "npp", ceoId: "ceo" },
        { _id: "peer-1", ceoType: "character", ceoId: "player" },
        { _id: "peer-2", ceoType: "npp", ceoId: "ceo-2", suspended: true },
      ],
      sectorsByCorp
    );
    // Energy: 30 vs peer mean 15. Banking has no peers and is skipped.
    expect(samples).toEqual([{ nppId: "ceo", lane: "energy", relMarginPp: 15 }]);
  });

  it("keys vehicle makers by their operating lane", () => {
    const vehicles = { sectorType: "manufacturing" as const, industryModel: "vehicles" };
    const samples = computeCeoSamples(
      [{ _id: "a", ceoType: "npp", ceoId: "ceo" }],
      new Map([
        ["a", [sector("a", 12, vehicles)]],
        ["b", [sector("b", 10, vehicles)]],
        ["c", [sector("c", 50, { sectorType: "manufacturing" })]],
      ])
    );
    expect(samples).toEqual([{ nppId: "ceo", lane: "manufacturing_vehicles", relMarginPp: 2 }]);
  });

  it("folds samples into a bounded, replay-safe record", () => {
    const first = applyCeoSample(undefined, 10, 24);
    expect(first).toEqual({ turns: CEO_RECORD_CADENCE_TURNS, relMarginPp: 10, lastTurn: 24 });
    expect(applyCeoSample(first, 99, 24)).toBe(first);
    const second = applyCeoSample(first, -10, 48);
    expect(second).toEqual({ turns: 2 * CEO_RECORD_CADENCE_TURNS, relMarginPp: 0, lastTurn: 48 });
    expect(applyCeoSample(undefined, 1000, 24).relMarginPp).toBe(CEO_RECORD_REL_CLAMP_PP);
    const long = applyCeoSample({ turns: CEO_RECORD_MAX_TURNS, relMarginPp: 1, lastTurn: 1 }, 1, 2);
    expect(long.turns).toBe(CEO_RECORD_MAX_TURNS);
  });

  it("only a long enough, positive record is a good record", () => {
    const line = (turns: number, relMarginPp: number) => ({
      energy: { turns, relMarginPp, lastTurn: turns },
    });
    expect(ceoRecordScore(undefined, "energy")).toBeNull();
    expect(ceoRecordScore(line(CEO_RECORD_MIN_TURNS - 1, 5), "energy")).toBeNull();
    expect(ceoRecordScore(line(48, 5), "energy")).toBeCloseTo(2.5);
    expect(hasGoodCeoRecord(line(48, 5), "energy")).toBe(true);
    expect(hasGoodCeoRecord(line(48, -5), "energy")).toBe(false);
    expect(hasGoodCeoRecord(line(48, 5), "financial")).toBe(false);
  });
});
