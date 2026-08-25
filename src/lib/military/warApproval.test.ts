import { describe, it, expect } from "vitest";
import {
  allianceContribution,
  buildWarModifier,
  stepWarTotal,
  warEffort,
  warExhaustion,
  type WarEffortInput,
} from "./warApproval";

/**
 * An interstate war opens with the defender holding all of its own soil, so
 * `control` is 100 with the declarer on side A driving it down (declareWar.ts,
 * initialControl). A proxy war whose host is not a belligerent opens at 50.
 */
const interstate = (control: number, over: Partial<WarEffortInput> = {}): WarEffortInput => ({
  control,
  entryControl: 100,
  turnsSinceEntry: 96,
  side: "A",
  ...over,
});

/**
 * 48 turns = 1 in-game year (constants/turnTime.ts). The floor and the slope are
 * an owner decision: +1 while the war is fresh, -1 per year, bottoming at -25
 * after 26 years. Deliberately outside the +/-2 scale in the approvalModifiers
 * header — see the plan. Do not "correct" these numbers.
 */
describe("warExhaustion", () => {
  it("pays a patriotic bonus while the war is fresh", () => {
    expect(warExhaustion(0)).toBe(1);
  });

  it("has spent the bonus after one in-game year", () => {
    expect(warExhaustion(48)).toBe(0);
  });

  it("costs a point per in-game year thereafter", () => {
    expect(warExhaustion(96)).toBe(-1);
    expect(warExhaustion(192)).toBe(-3);
  });

  it("moves continuously rather than stepping once a year", () => {
    expect(warExhaustion(24)).toBe(0.5);
    expect(warExhaustion(72)).toBe(-0.5);
  });

  it("reaches its floor after 26 in-game years", () => {
    expect(warExhaustion(26 * 48)).toBe(-25);
  });

  it("never falls past the floor however long the war runs", () => {
    expect(warExhaustion(100 * 48)).toBe(-25);
  });
});

describe("warEffort", () => {
  it("scores both sides at nothing on the turn war is declared", () => {
    const fresh = { control: 100, entryControl: 100, turnsSinceEntry: 0 };
    expect(warEffort({ ...fresh, side: "A" })).toBe(0);
    expect(warEffort({ ...fresh, side: "B" })).toBe(0);
  });

  it("rewards an attacker who takes ground and penalises the defender", () => {
    expect(warEffort(interstate(0, { side: "A", turnsSinceEntry: 100 }))).toBe(0.7);
    expect(warEffort(interstate(0, { side: "B", turnsSinceEntry: 100 }))).toBe(-0.7);
  });

  /**
   * The point of scoring against an expectation rather than against your own
   * pole. Territory alone bounds the attacker to [0, +1] and the defender to
   * [-1, 0], which made war effort a one-way subsidy for aggression.
   */
  it("turns against an attacker whose invasion has stalled", () => {
    expect(warEffort(interstate(100, { side: "A" }))).toBe(-0.7);
  });

  it("rewards a defender who has given up no ground at all", () => {
    expect(warEffort(interstate(100, { side: "B" }))).toBe(0.7);
  });

  it("scores a proxy war symmetrically, since stalemate is its expectation", () => {
    const proxy = { entryControl: 50, turnsSinceEntry: 96 };
    expect(warEffort({ ...proxy, control: 25, side: "A" })).toBe(0.7);
    expect(warEffort({ ...proxy, control: 25, side: "B" })).toBe(-0.7);
    expect(warEffort({ ...proxy, control: 75, side: "A" })).toBe(-0.7);
  });

  it("leaves a proxy front that has not moved at nothing for either side", () => {
    const still = { control: 50, entryControl: 50, turnsSinceEntry: 200 };
    expect(warEffort({ ...still, side: "A" })).toBe(0);
    expect(warEffort({ ...still, side: "B" })).toBe(0);
  });

  /**
   * A treaty ally pulled in on turn 900 must not inherit the war record its
   * side built before it arrived. Its baseline is the front as it stood then.
   */
  it("starts a late joiner from the front as it stood when they entered", () => {
    const joined = { control: 60, entryControl: 60, turnsSinceEntry: 0 };
    expect(warEffort({ ...joined, side: "A" })).toBe(0);
    expect(warEffort({ ...joined, side: "B" })).toBe(0);
  });

  it("scores a late joiner only on ground moved after they arrived", () => {
    const since = { entryControl: 60, turnsSinceEntry: 48 };
    expect(warEffort({ ...since, control: 45, side: "A" })).toBeGreaterThan(0);
    expect(warEffort({ ...since, control: 75, side: "A" })).toBeLessThan(0);
  });

  it("ignores momentum when no trailing sample has been taken yet", () => {
    expect(warEffort(interstate(100, { side: "B", sample: undefined }))).toBe(0.7);
  });

  /**
   * The sample refreshes only when a battle resolves, so its age drifts with
   * how often the front happens to fight. Momentum is a rate, not a raw
   * displacement, or an identical advance would score differently.
   */
  it("credits the same ground more when it was taken faster", () => {
    const base = { control: 90, entryControl: 100, side: "A" as const, turnsSinceEntry: 96 };
    const still = warEffort(base);
    const fast = warEffort({ ...base, turn: 124, sample: { turn: 100, control: 100 } });
    const slow = warEffort({ ...base, turn: 148, sample: { turn: 100, control: 100 } });
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(still);
  });

  it("cannot be farmed by oscillating across a fixed point", () => {
    let total = 0;
    for (let turn = 1; turn <= 240; turn += 1) {
      const control = turn % 4 === 0 ? 75 : 76;
      total += warEffort({
        control,
        entryControl: 100,
        side: "A",
        turnsSinceEntry: turn,
        turn,
        sample: { turn: turn - 24, control: turn % 4 === 0 ? 76 : 75 },
      });
    }
    expect(Math.abs(total / 240)).toBeLessThan(0.5);
  });

  it("never leaves its declared bounds", () => {
    const extreme = warEffort({
      control: 0,
      entryControl: 100,
      side: "A",
      turnsSinceEntry: 5000,
      turn: 5000,
      sample: { turn: 4999, control: 100 },
    });
    expect(extreme).toBeLessThanOrEqual(2);
    expect(extreme).toBeGreaterThanOrEqual(-2);
  });
});

describe("allianceContribution", () => {
  const settled = { turnsSinceEntry: 48 };

  it("scores a country pulling its weight at neutral", () => {
    expect(allianceContribution({ ...settled, mine: 100, peers: [100, 100, 100] })).toBe(0);
  });

  it("floors a country that has sent nothing", () => {
    expect(allianceContribution({ ...settled, mine: 0, peers: [0, 100, 100] })).toBe(-1);
  });

  it("pays a country carrying more than its share", () => {
    expect(allianceContribution({ ...settled, mine: 200, peers: [100, 100, 200] })).toBe(1);
  });

  /**
   * Theatre personnel is heavily tailed: the principal carries most of it. A
   * MEAN denominator therefore sits far above the typical member and reads a
   * normal small ally as a shirker, which put the modal outcome near the floor.
   */
  it("judges against the median ally, not the mean", () => {
    const coalition = { ...settled, mine: 10, peers: [10, 10, 10, 10, 1000] };
    expect(allianceContribution(coalition)).toBe(0);
  });

  it("still pays the principal carrying the coalition", () => {
    const principal = { ...settled, mine: 1000, peers: [10, 10, 10, 10, 1000] };
    expect(allianceContribution(principal)).toBe(1);
  });

  it("suppresses the penalty while forces could not yet have arrived", () => {
    expect(allianceContribution({ mine: 0, peers: [0, 100], turnsSinceEntry: 3 })).toBeNull();
  });

  it("applies the penalty once the grace window has passed", () => {
    expect(allianceContribution({ mine: 0, peers: [0, 100], turnsSinceEntry: 6 })).toBe(-1);
  });

  it("pays a bonus immediately, without waiting out the grace window", () => {
    const early = allianceContribution({ mine: 200, peers: [100, 200], turnsSinceEntry: 1 });
    expect(early).toBeGreaterThan(0);
  });

  it("floors every member of a coalition that deployed nothing", () => {
    expect(allianceContribution({ ...settled, mine: 0, peers: [0, 0, 0] })).toBe(-1);
  });

  it("never leaves its declared bounds", () => {
    expect(allianceContribution({ ...settled, mine: 99999, peers: [1, 1, 1] })).toBe(1);
  });
});

describe("stepWarTotal", () => {
  /**
   * dampApprovalStep adopts its target outright when there is no previous
   * value. Conflicts predating this feature carry no entry record, so an
   * original belligerent in a long war would otherwise land its whole
   * accumulated exhaustion in a single turn the day this ships.
   */
  it("ramps in from zero rather than adopting a deep total on the first turn", () => {
    expect(stepWarTotal(undefined, -25)).toBe(-2);
  });

  it("moves at most two points per turn toward the target", () => {
    expect(stepWarTotal(-10, -25)).toBe(-12);
    expect(stepWarTotal(0, 4)).toBe(2);
  });

  it("adopts the target once it is within a single step", () => {
    expect(stepWarTotal(-1, 0)).toBe(0);
    expect(stepWarTotal(-25, -24)).toBe(-24);
  });

  /** At peace the target is zero, so the block has to walk back rather than vanish. */
  it("retires gradually toward zero when the war has ended", () => {
    expect(stepWarTotal(-10, 0)).toBe(-8);
    expect(stepWarTotal(-8, 0)).toBe(-6);
  });
});

describe("buildWarModifier", () => {
  const parts = [
    { id: "war_effort", label: "War effort", effect: -1 },
    { id: "war_exhaustion", label: "War exhaustion", effect: -3 },
  ];

  it("carries the damped total as its effect, so chips cannot disagree with the rating", () => {
    expect(buildWarModifier(-2, parts)?.effect).toBe(-2);
  });

  it("renders nothing when the block has retired to zero", () => {
    expect(buildWarModifier(0, parts)).toBeNull();
  });

  /**
   * An unregistered id falls through to a 0.75 factor in marginEffectForModifier,
   * which would push a deep war penalty into every region's profit margins.
   */
  it("declares no profit margin effect", () => {
    expect(buildWarModifier(-2, parts)?.marginEffect).toBe(0);
  });

  it("identifies itself as a war modifier so the UI can explain it correctly", () => {
    expect(buildWarModifier(-2, parts)?.source).toBe("war");
  });

  it("labels itself in player-facing copy without dashes", () => {
    const label = buildWarModifier(-2, parts)?.label ?? "";
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toMatch(/[–—]/);
  });
});
