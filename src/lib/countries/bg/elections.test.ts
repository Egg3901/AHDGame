import { describe, expect, it } from "vitest";
import type { State } from "@/lib/db/types";
import { bgRegions2027 } from "./data/bgRegions2027";
import { bgAssemblySeatMapForPreset } from "./elections";

describe("Bulgaria Assembly spawning", () => {
  it("uses the authored 2027 regional seat map under the PR preset", () => {
    const seats = bgAssemblySeatMapForPreset(bgRegions2027 as State[], "2027-default", false);
    expect(Object.keys(seats)).toHaveLength(6);
    expect(Object.values(seats).reduce((sum, count) => sum + count, 0)).toBe(240);
  });
});
