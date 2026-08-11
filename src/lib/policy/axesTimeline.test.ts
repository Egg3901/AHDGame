import { describe, expect, it } from "vitest";
import {
  buildAxisEvents,
  replayAxesTimeline,
  type EnactedLawLike,
  type LegislationTypeLike,
} from "./axesTimeline";

function law(partial: Partial<EnactedLawLike> & { legislationTypeId: string }): EnactedLawLike {
  return {
    title: `Law ${partial.legislationTypeId}`,
    policyOptionIndex: 0,
    enactedAt: new Date("2026-01-01"),
    enactedYear: 2026,
    ...partial,
  };
}

function makeResolver(types: LegislationTypeLike[]) {
  const map = new Map(types.map((t) => [t._id, t]));
  return (id: string) => map.get(id);
}

describe("buildAxisEvents", () => {
  it("derives axis values from the enacted option, using type-level axis applicability", () => {
    const resolve = makeResolver([
      {
        _id: "min-wage",
        policyOptions: [
          { economic: -2, social: 0 },
          { economic: 1, social: 0 },
        ],
      },
    ]);
    const events = buildAxisEvents([law({ legislationTypeId: "min-wage" })], resolve);
    expect(events).toHaveLength(1);
    expect(events[0].economic).toBe(-2);
    expect(events[0].social).toBeNull(); // no option carries a social position
  });

  it("keeps an explicit 0 on an axis the type carries (centrist option)", () => {
    const resolve = makeResolver([
      {
        _id: "border",
        policyOptions: [
          { economic: 0, social: 0 }, // centrist option — enacted
          { economic: 0, social: 3 },
        ],
      },
    ]);
    const events = buildAxisEvents([law({ legislationTypeId: "border" })], resolve);
    expect(events).toHaveLength(1);
    expect(events[0].social).toBe(0);
    expect(events[0].economic).toBeNull();
  });

  it("skips laws whose type, options, or enacted option cannot be resolved", () => {
    const resolve = makeResolver([
      { _id: "no-options" },
      { _id: "short", policyOptions: [{ economic: 1, social: 0 }] },
    ]);
    const events = buildAxisEvents(
      [
        law({ legislationTypeId: "unknown-type" }),
        law({ legislationTypeId: "no-options" }),
        law({ legislationTypeId: "short", policyOptionIndex: 5 }),
        law({ legislationTypeId: "short", policyOptionIndex: undefined }),
      ],
      resolve
    );
    expect(events).toHaveLength(0);
  });

  it("skips laws that carry no axis at all (e.g. pure budget measures)", () => {
    const resolve = makeResolver([{ _id: "budget", policyOptions: [{ economic: 0, social: 0 }] }]);
    expect(buildAxisEvents([law({ legislationTypeId: "budget" })], resolve)).toHaveLength(0);
  });

  it("keys events by the resolved type id so alias ids replace correctly", () => {
    const resolve = (id: string) =>
      id === "alias-old" || id === "canonical"
        ? { _id: "canonical", policyOptions: [{ economic: 2, social: 0 }] }
        : undefined;
    const events = buildAxisEvents([law({ legislationTypeId: "alias-old" })], resolve);
    expect(events[0].typeKey).toBe("canonical");
  });
});

describe("replayAxesTimeline", () => {
  const event = (typeKey: string, economic: number | null, social: number | null, at: string) => ({
    typeKey,
    title: typeKey,
    enactedAt: new Date(at),
    enactedYear: new Date(at).getUTCFullYear(),
    economic,
    social,
  });

  it("returns empty series for no events", () => {
    expect(replayAxesTimeline([])).toEqual({ points: [], movers: [], events: [] });
  });

  it("exposes every enriched event for the Record-view timeline (movers stay capped)", () => {
    const all = Array.from({ length: 7 }, (_, i) =>
      event(`e${i}`, i - 3, null, `2026-0${i + 1}-01`)
    );
    const { events, movers } = replayAxesTimeline(all);
    expect(events).toHaveLength(7);
    expect(events[0].typeKey).toBe("e0"); // chronological, oldest first
    expect(events[6].economicAfter).not.toBeNull();
    expect(movers).toHaveLength(5);
  });

  it("tracks the running equal-weight average across distinct types", () => {
    const { points } = replayAxesTimeline([
      event("a", -3, null, "2026-01-01"),
      event("b", -1, null, "2026-02-01"),
    ]);
    expect(points[0].economicAvg).toBeCloseTo(-3);
    expect(points[1].economicAvg).toBeCloseTo(-2);
    expect(points[1].socialAvg).toBeNull();
  });

  it("replaces the prior contribution when the same type is re-enacted", () => {
    const { points } = replayAxesTimeline([
      event("tax", -4, null, "2026-01-01"),
      event("tax", 2, null, "2026-03-01"),
    ]);
    expect(points[1].economicAvg).toBeCloseTo(2); // not (-4 + 2) / 2
  });

  it("records per-event before/after on each axis the law carries", () => {
    const { movers } = replayAxesTimeline([
      event("a", -3, null, "2026-01-01"),
      event("b", -1, 2, "2026-02-01"),
    ]);
    // movers are newest-first
    expect(movers[0].typeKey).toBe("b");
    expect(movers[0].economicBefore).toBeCloseTo(-3);
    expect(movers[0].economicAfter).toBeCloseTo(-2);
    expect(movers[0].socialBefore).toBeNull(); // no prior social laws
    expect(movers[0].socialAfter).toBeCloseTo(2);
    expect(movers[1].economicBefore).toBeNull();
    expect(movers[1].economicAfter).toBeCloseTo(-3);
  });

  it("caps movers at the 5 most recent, newest first", () => {
    const events = Array.from({ length: 7 }, (_, i) =>
      event(`t${i}`, i, null, `2026-0${(i % 8) + 1}-01`)
    );
    const { movers } = replayAxesTimeline(events);
    expect(movers).toHaveLength(5);
    expect(movers[0].typeKey).toBe("t6");
    expect(movers[4].typeKey).toBe("t2");
  });

  it("axes a law does not carry stay untouched in before/after", () => {
    const { movers } = replayAxesTimeline([event("a", -3, null, "2026-01-01")]);
    expect(movers[0].socialBefore).toBeNull();
    expect(movers[0].socialAfter).toBeNull();
  });
});
