import { describe, expect, it } from "vitest";
import { computeDrift } from "../drift";
import { normalizeShares } from "../normalize";
import { effectivePlayPoints, type PlayContribution } from "./effectivePlayPoints";

const poles = ["WEST", "EAST"] as const;
const before = normalizeShares({ WEST: 22, EAST: 50 }, poles);
function resolve(
  plays: PlayContribution[],
  options: {
    shares?: typeof before;
    background?: Partial<Record<(typeof poles)[number], number>>;
    cap?: number;
  } = {}
) {
  const shares = options.shares ?? before;
  const background = options.background ?? {};
  const pull = { ...background };
  for (const play of plays)
    pull[play.poleId as "WEST" | "EAST"] =
      (pull[play.poleId as "WEST" | "EAST"] ?? 0) + play.points;
  const after = computeDrift({ shares, poles, pull, cap: options.cap });
  return effectivePlayPoints({ before: shares, after, background, plays });
}
const west = (id: string, points: number): PlayContribution => ({ id, points, poleId: "WEST" });

describe("effectivePlayPoints", () => {
  it.each([5, 7.5])("shares the %s turn cap across two full plays", (cap) => {
    expect([...resolve([west("a", 10), west("b", 10)], { cap }).values()]).toEqual([
      cap / 2,
      cap / 2,
    ]);
  });
  it("records zero for mutually canceled plays", () => {
    expect([...resolve([west("a", 10), { id: "b", poleId: "EAST", points: 10 }]).values()]).toEqual(
      [0, 0]
    );
  });
  it("only credits the surviving margin", () => {
    expect([...resolve([west("a", 10), { id: "b", poleId: "EAST", points: 8 }]).values()]).toEqual([
      2, 0,
    ]);
  });
  it("accounts for non-aligned resistance", () => {
    expect(
      resolve([west("a", 8)], { shares: normalizeShares({ WEST: 30, EAST: 30 }, poles) }).get("a")
    ).toBe(4);
  });
  it("credits normalized gain when no uncommitted share remains", () => {
    expect(
      resolve([west("a", 1)], { shares: normalizeShares({ WEST: 26, EAST: 74 }, poles) }).get("a")
    ).toBe(0.73);
  });
  it("leaves passive movement its proportional share", () => {
    expect(resolve([west("a", 1)], { background: { WEST: 1 } }).get("a")).toBe(1);
    expect(resolve([west("a", 10)], { background: { WEST: 10 } }).get("a")).toBe(2.5);
  });
  it("lets sanctions reduce attributable gain", () => {
    expect(resolve([west("a", 4)], { background: { WEST: -3 } }).get("a")).toBe(1);
  });
  it("records zero at the locked gate", () => {
    expect(
      resolve([west("a", 10)], { shares: normalizeShares({ WEST: 2, EAST: 90 }, poles) }).get("a")
    ).toBe(0);
  });
  it("uses contribution weights and deterministic hundredths", () => {
    const plays = [west("b", 10), west("a", 10), west("c", 10)];
    const result = resolve(plays);
    expect(Object.fromEntries(result)).toEqual({ a: 1.67, b: 1.67, c: 1.66 });
    expect(Object.fromEntries(resolve([...plays].reverse()))).toEqual(Object.fromEntries(result));
    expect([...resolve([west("a", 10), west("b", 5)]).values()]).toEqual([3.33, 1.67]);
  });
  it("never invents extra hundredths across many tiny contributions", () => {
    for (let count = 1; count <= 200; count++) {
      const result = resolve(Array.from({ length: count }, (_, i) => west(String(i), 10)));
      expect([...result.values()].reduce((sum, value) => sum + Math.round(value * 100), 0)).toBe(
        500
      );
    }
  });
  it("does not credit missing or nonpositive contributions", () => {
    expect([...resolve([west("a", 0), west("b", -1)]).values()]).toEqual([0, 0]);
  });

  it("attributes only the winning margin with three competing poles", () => {
    const activePoles = ["WEST", "EAST", "ORG:third"] as const;
    const shares = normalizeShares({ WEST: 40, EAST: 10, "ORG:third": 5 }, activePoles);
    const plays: PlayContribution[] = [
      west("a", 4),
      { id: "b", poleId: "EAST", points: 2 },
      { id: "c", poleId: "ORG:third", points: 6 },
    ];
    const after = computeDrift({
      shares,
      poles: activePoles,
      pull: { WEST: 4, EAST: 2, "ORG:third": 6 },
    });
    expect(
      Object.fromEntries(effectivePlayPoints({ before: shares, after, background: {}, plays }))
    ).toEqual({ a: 0, b: 0, c: 2 });
  });
});
