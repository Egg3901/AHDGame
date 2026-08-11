import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { computeThroughput, inputAvailability, THROUGHPUT_MIN } from "./throughput";

type Balance = { supply: number; demand: number };
const bals = (entries: Array<[CommodityType, Balance]>) => new Map(entries);

describe("inputAvailability", () => {
  it("is supply/demand capped at 1", () => {
    expect(inputAvailability({ supply: 60, demand: 100 })).toBe(0.6);
    expect(inputAvailability({ supply: 300, demand: 100 })).toBe(1);
  });
  it("treats missing or degenerate data as fully available", () => {
    expect(inputAvailability(undefined)).toBe(1);
    expect(inputAvailability({ supply: 100, demand: 0 })).toBe(1);
  });
});

describe("computeThroughput", () => {
  it("is 1 with no inputs, no binding input reported", () => {
    expect(computeThroughput({}, bals([]))).toEqual({ throughput: 1, bindingInput: null });
  });

  it("the scarcest input binds", () => {
    const r = computeThroughput(
      { steel: 0.3, energy: 0.2 },
      bals([
        ["steel", { supply: 90, demand: 100 }],
        ["energy", { supply: 60, demand: 100 }],
      ])
    );
    expect(r.throughput).toBe(0.6);
    expect(r.bindingInput).toBe("energy");
  });

  it("floors at THROUGHPUT_MIN so a shortage never zeroes a sector", () => {
    const r = computeThroughput(
      { rare_earth: 0.1 },
      bals([["rare_earth", { supply: 5, demand: 100 }]])
    );
    expect(r.throughput).toBe(THROUGHPUT_MIN);
    expect(r.bindingInput).toBe("rare_earth");
  });

  it("inputs missing from the balance map do not constrain", () => {
    const r = computeThroughput({ rare_earth: 0.5 }, bals([]));
    expect(r).toEqual({ throughput: 1, bindingInput: null });
  });

  it("zero-rate inputs are ignored", () => {
    const r = computeThroughput({ steel: 0 }, bals([["steel", { supply: 1, demand: 100 }]]));
    expect(r).toEqual({ throughput: 1, bindingInput: null });
  });
});
