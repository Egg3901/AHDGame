import { describe, expect, it } from "vitest";
import {
  planRussianDumaConvocation as plan,
  russianDumaConvocationTermEnd as termEnd,
  russianDumaConvocationOfficeCompatible as compatible,
} from "./dumaConvocation";
const current = { number: 1, rootId: "first", seatedOnTurn: 145, termEndTurn: 237 };
describe("ordinary Russian Duma convocations", () => {
  it("opens a complete campaign to finish at the first term boundary", () => {
    expect(plan({ turn: 224, current })).toEqual({ kind: "wait" });
    expect(plan({ turn: 225, current })).toMatchObject({
      kind: "open",
      number: 2,
      timing: { startTurn: 225, endTurn: 237 },
    });
  });
  it("schedules a late campaign from now without extending the previous term", () => {
    expect(plan({ turn: 250, current })).toMatchObject({
      kind: "open",
      timing: { startTurn: 250, endTurn: 262 },
    });
    expect(current.termEndTurn).toBe(237);
  });
  it("resumes one pending campaign instead of opening another", () => {
    expect(plan({ turn: 240, current, pendingRootId: "second" })).toEqual({
      kind: "resume",
      rootId: "second",
    });
  });
  it("renews later convocations on their own four-year clock", () => {
    const second = { number: 2, rootId: "second", seatedOnTurn: 238, termEndTurn: termEnd(237, 2) };
    expect(second.termEndTurn).toBe(429);
    expect(plan({ turn: 417, current: second })).toMatchObject({
      kind: "open",
      number: 3,
      timing: { endTurn: 429 },
    });
    expect(termEnd(141, 1)).toBe(237);
  });
  it.each([0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER])("rejects unsafe term inputs %s", (turn) => {
    expect(() => termEnd(turn, 2)).toThrow();
  });
  it.each(["primeMinister", "parliamentaryCabinet"])(
    "ends the first-Duma Government exception for %s",
    (office) => {
      expect(compatible(1, office, "RU")).toBe(true);
      expect(compatible(2, office, "RU")).toBe(false);
    }
  );
  it("permits incumbents to seek renewal but preserves Council incompatibility", () => {
    expect(compatible(2, "dumaDeputy", "RU")).toBe(true);
    expect(compatible(2, "federationCouncilMember", "RU")).toBe(false);
    expect(compatible(2, "dumaDeputy", "UK")).toBe(false);
  });
  it("rejects a bare or future activation clock and a reused pending root", () => {
    expect(() => plan({ turn: 150, current: { ...current, termEndTurn: 145 } })).toThrow();
    expect(() => plan({ turn: 144, current })).toThrow();
    expect(() => plan({ turn: 225, current, pendingRootId: "first" })).toThrow();
  });
});
