import { describe, expect, it } from "vitest";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import {
  VENTURE_BOOST_TURNS,
  VENTURE_DEVELOPMENT_TURNS,
  VENTURE_EVENT_RESPONSE_TURNS,
  VENTURE_MAX_STACKED_BOOST,
  advanceBoost,
  advanceDevelopment,
  applyEventChoice,
  boostFractionForQuality,
  eventPool,
  hitProbability,
  newVenture,
  qualityFromInvestment,
  referenceFundingPerTurn,
  rollOutcome,
  scheduleEvents,
  seededUnit,
  stackedBoostMultiplier,
  ventureOdds,
  ventureTargetAnchor,
} from "./engine";
import { VENTURE_EVENTS } from "./events";
import type { ProductVenture } from "./types";

function make(id: string, domain: "media" | "manufacturing" = "media", lineId = "film") {
  return newVenture({
    id,
    corporationId: "corp-1",
    domain,
    lineId: domain === "media" ? lineId : "passenger_car",
    name: "Test",
    turn: 100,
    baselineRevenueAnchor: 100_000,
  });
}

/** Funds a venture at a multiple of reference funding and runs it to release. */
function run(venture: ProductVenture, multiple = 1, avgQuality?: number): ProductVenture {
  let current = venture;
  const funding = referenceFundingPerTurn(current.targetAnchor) * multiple;
  for (let turn = venture.startedTurn + 1; turn < venture.startedTurn + 400; turn++) {
    const step = advanceDevelopment(current, {
      turn,
      investmentPaidAnchor: funding,
      chargePaidAnchor: Math.min(funding, current.pendingChargeAnchor),
      averageQuality: avgQuality,
    });
    if (!step) continue;
    current = step.venture;
    if (step.completed) return current;
  }
  throw new Error("never completed");
}

describe("venture timing", () => {
  it("derives three days from the turn cadence", () => {
    expect(VENTURE_DEVELOPMENT_TURNS).toBe(3 * TURNS_PER_DAY);
    expect(VENTURE_BOOST_TURNS).toBe(3 * TURNS_PER_DAY);
    expect(make("a").endTurn - 100).toBe(VENTURE_DEVELOPMENT_TURNS);
  });
});

describe("seeded randomness", () => {
  it("is deterministic and in range", () => {
    expect(seededUnit("x")).toBe(seededUnit("x"));
    expect(seededUnit("x")).not.toBe(seededUnit("y"));
    for (let i = 0; i < 200; i++) {
      const u = seededUnit(`s${i}`);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

describe("quality and odds", () => {
  it("has diminishing returns on investment", () => {
    const half = qualityFromInvestment(50, 100);
    const full = qualityFromInvestment(100, 100);
    const double = qualityFromInvestment(200, 100);
    expect(half).toBeLessThan(full);
    expect(full).toBeLessThan(double);
    expect(double - full).toBeLessThan(full - half + 20);
    expect(double).toBeLessThanOrEqual(100);
  });

  it("flops often at average funding and is never certain", () => {
    const q = qualityFromInvestment(1, 1);
    const p = hitProbability(q);
    expect(p).toBeGreaterThan(0.35);
    expect(p).toBeLessThan(0.5);
    expect(hitProbability(100)).toBeLessThanOrEqual(0.65);
    expect(hitProbability(0)).toBeGreaterThanOrEqual(0.05);
  });

  it("matches the sampled hit rate across many seeded ventures", () => {
    let hits = 0;
    const n = 3000;
    let expected = 0;
    for (let i = 0; i < n; i++) {
      const done = run(make(`dist-${i}`));
      expected += done.hitProbability ?? 0;
      if (done.outcome === "hit") hits++;
    }
    const rate = hits / n;
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.55);
    expect(Math.abs(rate - expected / n)).toBeLessThan(0.04);
  });

  it("scales the lift from 10 to 20 percent by quality", () => {
    expect(boostFractionForQuality(10)).toBeCloseTo(0.1);
    expect(boostFractionForQuality(100)).toBeCloseTo(0.2);
    expect(boostFractionForQuality(65)).toBeGreaterThan(0.1);
    expect(boostFractionForQuality(65)).toBeLessThan(0.2);
  });

  it("shows an honest odds band that narrows at release", () => {
    const v = make("odds");
    const early = ventureOdds(v, 101);
    expect(early.hitHigh).toBeGreaterThan(early.hitLow);
    const late = ventureOdds(
      { ...v, events: v.events.map((e) => ({ ...e, choiceId: "x" })) },
      v.endTurn
    );
    expect(late.hitHigh).toBe(late.hitLow);
  });
});

describe("funding and idempotency", () => {
  it("accumulates investment and spend, and ignores a replayed turn", () => {
    const v = make("fund");
    const first = advanceDevelopment(v, {
      turn: 101,
      investmentPaidAnchor: 500,
      chargePaidAnchor: 0,
    });
    expect(first?.venture.investedAnchor).toBe(500);
    expect(first?.venture.spentAnchor).toBe(500);
    expect(
      advanceDevelopment(first!.venture, {
        turn: 101,
        investmentPaidAnchor: 500,
        chargePaidAnchor: 0,
      })
    ).toBeNull();
    expect(
      advanceDevelopment(first!.venture, {
        turn: 100,
        investmentPaidAnchor: 500,
        chargePaidAnchor: 0,
      })
    ).toBeNull();
  });

  it("gives the same outcome on every replay of the same venture", () => {
    const a = run(make("replay"));
    const b = run(make("replay"));
    expect(a.outcome).toBe(b.outcome);
    expect(a.finalQuality).toBe(b.finalQuality);
    expect(rollOutcome("replay")).toBe(rollOutcome("replay"));
  });

  it("flops with no funding", () => {
    let flops = 0;
    for (let i = 0; i < 200; i++) if (run(make(`zero-${i}`), 0).outcome === "flop") flops++;
    expect(flops).toBeGreaterThan(170);
  });
});

describe("events", () => {
  it("has a wide pool in both domains with 2 to 3 choices and a valid default", () => {
    for (const domain of ["media", "manufacturing"] as const) {
      expect(VENTURE_EVENTS.filter((e) => e.domain === domain).length).toBeGreaterThanOrEqual(12);
    }
    for (const event of VENTURE_EVENTS) {
      expect(event.choices.length).toBeGreaterThanOrEqual(2);
      expect(event.choices.length).toBeLessThanOrEqual(3);
      expect(event.choices.some((c) => c.id === event.defaultChoiceId)).toBe(true);
      for (const c of event.choices) {
        expect(c.chargeFraction).toBeGreaterThanOrEqual(0);
        expect(`${event.title}${event.body}${c.label}${c.detail}`).not.toMatch(/[–—]/);
      }
    }
  });

  it("schedules one or two events per product, inside the window, from a wide pool", () => {
    const seen = new Set<string>();
    const counts = new Set<number>();
    for (let i = 0; i < 300; i++) {
      for (const lineId of ["film", "newspaper_edition", "music_release"]) {
        const events = scheduleEvents({
          ventureId: `s-${i}`,
          domain: "media",
          lineId,
          startedTurn: 0,
        });
        counts.add(events.length);
        for (const e of events) {
          seen.add(e.eventId);
          expect(e.triggerTurn).toBeGreaterThan(0);
          expect(e.triggerTurn + VENTURE_EVENT_RESPONSE_TURNS).toBeLessThanOrEqual(
            VENTURE_DEVELOPMENT_TURNS
          );
        }
      }
    }
    expect([...counts].sort()).toEqual([1, 2]);
    expect(seen.size).toBeGreaterThanOrEqual(10);
    for (const line of ["film", "newspaper_edition", "book", "radio_program"]) {
      expect(eventPool("media", line).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("applies the default at the deadline and counts its cost and delay", () => {
    let v = make("evt");
    const rec = v.events[0]!;
    const turn = rec.triggerTurn;
    v = advanceDevelopment(v, { turn, investmentPaidAnchor: 0, chargePaidAnchor: 0 })!.venture;
    expect(v.events[0]!.offeredTurn).toBe(turn);
    const deadline = v.events[0]!.deadlineTurn!;
    const step = advanceDevelopment(v, {
      turn: deadline,
      investmentPaidAnchor: 0,
      chargePaidAnchor: 0,
    })!;
    const resolved = step.venture.events[0]!;
    expect(resolved.auto).toBe(true);
    expect(step.defaulted).toContain(rec.eventId);
  });

  it("applies a chosen option to quality, pending cost and timeline", () => {
    const v = make("choice", "media", "film");
    const rec = { ...v.events[0]!, offeredTurn: 110, deadlineTurn: 130 };
    const withOffer = { ...v, events: [rec, ...v.events.slice(1)] };
    const def = VENTURE_EVENTS.find((e) => e.id === rec.eventId)!;
    const choice = def.choices.find((c) => c.chargeFraction > 0 || c.delayTurns !== 0)!;
    const next = applyEventChoice(withOffer, rec.eventId, choice.id, 111, false)!;
    expect(next.qualityShift).toBe(choice.qualityDelta);
    expect(next.pendingChargeAnchor).toBeCloseTo(choice.chargeFraction * v.targetAnchor);
    expect(next.endTurn).toBe(
      Math.max(Math.max(112, 100 + TURNS_PER_DAY), v.endTurn + choice.delayTurns)
    );
    expect(applyEventChoice(next, rec.eventId, choice.id, 112, false)).toBeNull();
    expect(applyEventChoice(v, rec.eventId, choice.id, 111, false)).toBeNull();
  });
});

describe("boost", () => {
  it("applies while running and expires after the window", () => {
    let v = run(make("boost-hit-search"));
    for (let i = 0; v.outcome !== "hit" && i < 100; i++) v = run(make(`bs-${i}`));
    expect(v.stage).toBe("released");
    const end = v.boostEndsTurn!;
    expect(end - v.releasedTurn!).toBe(VENTURE_BOOST_TURNS);
    const mid = advanceBoost(v, { turn: v.releasedTurn! + 1, upliftAnchor: 1000 })!;
    expect(mid.upliftToDateAnchor).toBe(1000);
    expect(mid.stage).toBe("released");
    expect(advanceBoost(mid, { turn: v.releasedTurn! + 1, upliftAnchor: 1000 })).toBeNull();
    const last = advanceBoost(mid, { turn: end, upliftAnchor: 1000 })!;
    expect(last.stage).toBe("released");
    const over = advanceBoost(last, { turn: end + 1, upliftAnchor: 1000 })!;
    expect(over.stage).toBe("expired");
    expect(over.upliftToDateAnchor).toBe(last.upliftToDateAnchor);
  });

  it("caps stacked lifts", () => {
    expect(stackedBoostMultiplier([0.15])).toBeCloseTo(1.15);
    expect(stackedBoostMultiplier([0.2, 0.2, 0.2])).toBeCloseTo(1 + VENTURE_MAX_STACKED_BOOST);
    expect(stackedBoostMultiplier([])).toBe(1);
  });
});

describe("funding target against real revenue scale", () => {
  it("keeps spend and lift moderate at median and leader media corporations", () => {
    // Observed US media revenue (daily basis in anchor): median corp ~302k, leader ~13.2M.
    for (const [daily, label] of [
      [302_284, "median"],
      [13_187_858, "leader"],
    ] as const) {
      const perTurn = daily / TURNS_PER_DAY;
      const target = ventureTargetAnchor(perTurn);
      const standard = referenceFundingPerTurn(target);
      const spendShare = standard / perTurn;
      const lift = perTurn * boostFractionForQuality(qualityFromInvestment(target, target));
      expect(spendShare, label).toBeLessThan(0.025);
      expect(lift / perTurn, label).toBeGreaterThanOrEqual(0.1);
      expect(lift / perTurn, label).toBeLessThanOrEqual(0.2);
    }
  });
});

describe("repricing at completion", () => {
  function finish(venture: ProductVenture, liftedRevenueAnchor: number): ProductVenture {
    let current = venture;
    const funding = referenceFundingPerTurn(current.targetAnchor);
    for (let turn = venture.startedTurn + 1; turn < venture.startedTurn + 400; turn++) {
      const step = advanceDevelopment(current, {
        turn,
        investmentPaidAnchor: funding,
        chargePaidAnchor: Math.min(funding, current.pendingChargeAnchor),
        liftedRevenueAnchor,
      });
      if (!step) continue;
      current = step.venture;
      if (step.completed) return current;
    }
    throw new Error("never completed");
  }

  it("judges a product against the business it would lift at release", () => {
    const steady = finish(make("reprice-a"), 100_000);
    const expanded = finish(make("reprice-a"), 1_000_000);
    expect(expanded.targetAnchor).toBe(ventureTargetAnchor(1_000_000));
    expect(expanded.finalQuality!).toBeLessThan(steady.finalQuality!);
  });

  it("never lowers the original target when revenue fell", () => {
    const venture = make("reprice-b");
    const shrunk = finish(venture, 10);
    expect(shrunk.targetAnchor).toBe(venture.targetAnchor);
  });
});
