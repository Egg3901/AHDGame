import { describe, expect, it } from "vitest";
import { polesForYear } from "@/lib/constants/alignmentEras";
import { normalizeShares } from "./normalize";
import { contestRank, mostContested, tugOfWarCandidate } from "./crisis";

const POLES = polesForYear(1979);
const at = (w: number, e: number) => normalizeShares({ WEST: w, EAST: e }, POLES);

describe("contestRank / mostContested", () => {
  const row = (id: string, w: number, e: number) => ({ entityId: id, shares: at(w, e) });

  it("ranks a genuine tug-of-war above a nation nobody wants", () => {
    const tug = at(35, 33); // lead 2, both invested
    const ignored = at(6, 4); // lead 2, but nobody holds anything
    expect(contestRank(tug, POLES)).toBeGreaterThan(contestRank(ignored, POLES));
  });

  it("ranks a settled nation lowest", () => {
    const settled = at(90, 2);
    const tug = at(35, 33);
    expect(contestRank(settled, POLES)).toBeLessThan(contestRank(tug, POLES));
  });

  it("picks the most contested nation from a field", () => {
    const picked = mostContested([row("US", 95, 1), row("YU", 34, 32), row("SE", 30, 18)], POLES);
    expect(picked).toBe("YU");
  });

  it("returns null for an empty field", () => {
    expect(mostContested([], POLES)).toBeNull();
  });
});

describe("tugOfWarCandidate", () => {
  it("flags a nation two blocs are both invested in", () => {
    expect(tugOfWarCandidate(at(30, 28), POLES)).toBe(true);
  });

  it("ignores a nation with a decisive leader", () => {
    expect(tugOfWarCandidate(at(70, 5), POLES)).toBe(false);
  });

  it("ignores a nation nobody has invested in, however even", () => {
    // Even shares mean nothing if neither bloc actually holds the country.
    expect(tugOfWarCandidate(at(8, 7), POLES)).toBe(false);
  });
});
