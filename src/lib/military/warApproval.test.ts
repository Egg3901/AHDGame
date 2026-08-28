import { describe, it, expect } from "vitest";
import {
  allianceContribution,
  buildWarModifiers,
  nextControlSample,
  stepWarExhaustion,
  warEffort,
  warExhaustion,
  WAR_EXHAUSTION_FLOOR,
  WAR_EXHAUSTION_RATE,
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
   * The sample belongs to the conflict, not to any one belligerent. A country
   * that joined two turns ago must not be credited with an advance its side
   * made before it arrived.
   */
  it("ignores a momentum sample taken before the country entered", () => {
    const joined = {
      control: 45,
      entryControl: 45,
      side: "A" as const,
      turnsSinceEntry: 2,
      turn: 902,
      entryTurn: 900,
    };
    const withStale = warEffort({ ...joined, sample: { turn: 880, control: 100 } });
    const withNone = warEffort({ ...joined, sample: undefined });
    expect(withStale).toBe(withNone);
  });

  /**
   * The sample refreshes only when a battle resolves, so its age drifts with
   * how often the front happens to fight. Momentum is a rate, not a raw
   * displacement, or an identical advance would score differently.
   */
  /**
   * The sample refreshes only when a battle resolves, so its age drifts freely
   * between zero and the window. Inside the window the same ground must score
   * the same however many turns ago the sample happened to be taken, or an
   * identical advance is worth four times as much purely because the front
   * fought recently.
   */
  it("scores the same advance identically anywhere inside the momentum window", () => {
    const base = { control: 95, entryControl: 100, side: "A" as const, turnsSinceEntry: 96 };
    const justSampled = warEffort({ ...base, turn: 101, sample: { turn: 100, control: 100 } });
    const fullWindow = warEffort({ ...base, turn: 124, sample: { turn: 100, control: 100 } });
    expect(justSampled).toBe(fullWindow);
  });

  it("dilutes an advance measured against a sample older than the window", () => {
    const base = { control: 95, entryControl: 100, side: "A" as const, turnsSinceEntry: 96 };
    const fresh = warEffort({ ...base, turn: 124, sample: { turn: 100, control: 100 } });
    const stale = warEffort({ ...base, turn: 220, sample: { turn: 100, control: 100 } });
    expect(stale).toBeLessThan(fresh);
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

  /**
   * A reseed or an admin rewind can move the clock backwards. A negative age
   * must not run the expectation backwards and start crediting an attacker for
   * ground it has not taken.
   */
  it("treats a negative war age as a war that has just begun", () => {
    const rewound = { control: 100, entryControl: 100, turnsSinceEntry: -500 };
    expect(warEffort({ ...rewound, side: "A" })).toBe(0);
    expect(warEffort({ ...rewound, side: "B" })).toBe(0);
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

  /**
   * With more than half the side absent the median is zero, and dividing by it
   * would score EVERY member at the floor including the one actually fighting
   * the war. Sending anything when the typical ally sends nothing is carrying it.
   */
  it("pays the one country carrying a coalition of no-shows", () => {
    expect(allianceContribution({ ...settled, mine: 500000, peers: [0, 0, 0, 500000] })).toBe(1);
  });

  it("still floors the absentees in that same coalition", () => {
    expect(allianceContribution({ ...settled, mine: 0, peers: [0, 0, 0, 500000] })).toBe(-1);
  });

  it("never leaves its declared bounds", () => {
    expect(allianceContribution({ ...settled, mine: 99999, peers: [1, 1, 1] })).toBe(1);
  });
});

describe("stepWarExhaustion", () => {
  const at = (over: Partial<Parameters<typeof stepWarExhaustion>[0]> = {}) =>
    stepWarExhaustion({
      prev: 0,
      conflictId: "war_1",
      prevConflictId: "war_1",
      turnsSinceEntry: 10,
      ...over,
    });

  /**
   * A country already fighting when this shipped has no stored value. Seeding
   * from the original closed-form curve keeps it exactly where it was; without
   * it the rally below fires on an existing war and hands a nation forty turns
   * deep a fresh +1.
   */
  it("seeds an unscored country at war from the original curve", () => {
    expect(at({ prev: undefined, prevConflictId: undefined, turnsSinceEntry: 0 })).toBe(1);
    expect(at({ prev: undefined, prevConflictId: undefined, turnsSinceEntry: 48 })).toBe(0);
    expect(at({ prev: undefined, prevConflictId: undefined, turnsSinceEntry: 96 })).toBe(-1);
  });

  it("seeds from the curve rather than rallying, even though the war id is new", () => {
    expect(at({ prev: undefined, prevConflictId: null, turnsSinceEntry: 192 })).toBe(-3);
  });

  it("accrues one point per in-game year while the same war runs", () => {
    expect(at({ prev: 0 })).toBeCloseTo(-WAR_EXHAUSTION_RATE, 6);
    let value = 1;
    for (let i = 0; i < 48; i += 1) value = at({ prev: value });
    expect(value).toBeCloseTo(0, 4);
  });

  it("never falls past the floor", () => {
    expect(at({ prev: WAR_EXHAUSTION_FLOOR })).toBe(WAR_EXHAUSTION_FLOOR);
  });

  /**
   * The cooldown. Ending a war used to reset exhaustion outright, so a
   * government could sign a treaty and declare again the same turn with a clean
   * slate and no cost that ever caught up with it.
   */
  it("heals toward zero at the same pace once the fighting stops", () => {
    expect(at({ prev: -1, conflictId: null })).toBeCloseTo(WAR_EXHAUSTION_RATE - 1, 3);
  });

  it("takes an in-game year of peace to shed a point", () => {
    let value = -1;
    for (let i = 0; i < 48; i += 1) value = at({ prev: value, conflictId: null });
    expect(value).toBe(0);
  });

  it("settles exactly on zero rather than overshooting into a peace bonus", () => {
    expect(at({ prev: -WAR_EXHAUSTION_RATE, conflictId: null })).toBe(0);
    expect(at({ prev: 0, conflictId: null })).toBe(0);
  });

  /**
   * A war won inside its first year ends while the rally is still positive.
   * Peace has to retire that at the same pace it retires a penalty: moving away
   * from zero and then cutting it off would drop half a point of approval on the
   * turn the treaty was signed.
   */
  it("retires a positive rally toward zero rather than away from it", () => {
    expect(at({ prev: 0.5, conflictId: null })).toBeCloseTo(0.5 - WAR_EXHAUSTION_RATE, 5);
  });

  it("takes an in-game year of peace to shed a point of rally too", () => {
    let value = 1;
    for (let i = 0; i < 48; i += 1) value = at({ prev: value, conflictId: null });
    expect(value).toBe(0);
  });

  it("never lets peace push exhaustion past zero into a bonus", () => {
    for (const start of [0.4, -0.4, WAR_EXHAUSTION_RATE / 2, -WAR_EXHAUSTION_RATE / 2]) {
      let value = start;
      for (let i = 0; i < 200; i += 1) value = at({ prev: value, conflictId: null });
      expect(value).toBe(0);
    }
  });

  it("keeps a country that has never fought at zero", () => {
    expect(at({ prev: undefined, conflictId: null, prevConflictId: undefined })).toBe(0);
  });

  it("rallies by one on entering a war from peace, capped at one", () => {
    expect(at({ prev: 0, conflictId: "war_2", prevConflictId: null })).toBe(1);
    expect(at({ prev: -3, conflictId: "war_2", prevConflictId: null })).toBe(-2);
  });

  /**
   * A country fighting two wars whose older war resolves has its principal
   * conflict change underneath it without the fighting ever stopping. Paying a
   * rally there hands out +1 for ending a war while still at war, which is the
   * cooldown's own exploit in miniature.
   */
  it("does not rally when one war ends while another is still being fought", () => {
    expect(at({ prev: -2, conflictId: "war_b", prevConflictId: "war_a" })).toBeLessThan(-2);
  });

  it("does not rally going straight from one war into the next with no peace", () => {
    expect(at({ prev: -3, conflictId: "war_2", prevConflictId: "war_1" })).toBeLessThan(-3);
  });

  it("treats a document written before the conflict id existed as peace", () => {
    expect(at({ prev: -3, conflictId: "war_1", prevConflictId: undefined })).toBe(-2);
  });

  /**
   * The exploit, stated as a test. A country that fought itself to -3 and
   * immediately declares again opens at -2, not at +1.
   */
  it("carries residue into the next war instead of wiping it", () => {
    // A turn of peace stores a null conflict id, which is what the next war sees.
    const residue = at({ prev: -3, conflictId: null, prevConflictId: "war_1" });
    expect(at({ prev: residue, conflictId: "war_2", prevConflictId: null })).toBeLessThan(0);
  });

  /**
   * Keyed on the stored conflict id being null, not on turnsSinceEntry === 0: a
   * turn the snapshot did not run for this country would otherwise swallow the
   * transition and the rally would never be paid at all.
   */
  it("rallies on entering from peace however long that war has been running", () => {
    expect(at({ prev: -2, conflictId: "war_2", prevConflictId: null, turnsSinceEntry: 90 })).toBe(
      -1
    );
  });

  it("does not rally again on a war it is already accruing against", () => {
    expect(at({ prev: -2, conflictId: "war_1", prevConflictId: "war_1" })).toBeLessThan(-2);
  });

  it("recovers from a corrupt stored value by reseeding", () => {
    expect(at({ prev: Number.NaN, turnsSinceEntry: 96 })).toBe(-1);
  });
});

describe("buildWarModifiers", () => {
  const live = { exhaustion: -1.2, effort: 0.4, contribution: null, phase: "live" as const };

  it("emits one chip per term rather than a single combined total", () => {
    const ids = buildWarModifiers({ ...live, contribution: 0.7 }).map((m) => m.id);
    expect(ids).toEqual(["war_exhaustion", "war_effort", "alliance_contribution"]);
  });

  /**
   * The reason for the split. A long war going well reads as a positive effort
   * chip beside a negative exhaustion chip; combined it read "War -0.8" and told
   * the player their winning war was going badly.
   */
  it("keeps a winning front visible beside a tired public", () => {
    const chips = buildWarModifiers({
      exhaustion: -2,
      effort: 1.2,
      contribution: null,
      phase: "live" as const,
    });
    expect(chips.find((m) => m.id === "war_effort")?.effect).toBe(1.2);
    expect(chips.find((m) => m.id === "war_exhaustion")?.effect).toBe(-2);
  });

  it("sums to the applied total, since nothing is damped any more", () => {
    const chips = buildWarModifiers({
      exhaustion: -2,
      effort: 1.2,
      contribution: 0.5,
      phase: "live" as const,
    });
    expect(chips.reduce((s, m) => s + m.effect, 0)).toBeCloseTo(-0.3, 5);
  });

  /**
   * An unregistered id falls through to a 0.75 factor in marginEffectForModifier,
   * which would push a deep war penalty into every region's profit margins.
   * Splitting one chip into three multiplies that trap rather than removing it.
   */
  it("declares no profit margin effect on any chip", () => {
    for (const chip of buildWarModifiers({ ...live, contribution: 0.7 })) {
      expect(chip.marginEffect).toBe(0);
    }
  });

  it("identifies every chip as a war modifier", () => {
    for (const chip of buildWarModifiers({ ...live, contribution: 0.7 })) {
      expect(chip.source).toBe("war");
    }
  });

  it("gives every chip a distinct id, so they cannot collide on the React key", () => {
    const ids = buildWarModifiers({ ...live, contribution: 0.7 }).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels itself in player facing copy without dashes", () => {
    for (const chip of buildWarModifiers({ ...live, contribution: 0.7 })) {
      expect(chip.label).not.toMatch(/[–—]/);
    }
  });

  /**
   * The reported bug: at turn 457 the United States was forty two turns into the
   * War for Germany with effort at -0.1 and exhaustion at +0.1, and the combined
   * chip disappeared entirely. Every war term shows while the fighting is live,
   * zero included.
   */
  it("shows a war term at zero while the fighting is live", () => {
    const chips = buildWarModifiers({
      exhaustion: 0,
      effort: 0,
      contribution: null,
      phase: "live" as const,
    });
    expect(chips.map((m) => m.id)).toEqual(["war_exhaustion", "war_effort"]);
  });

  it("drops the front terms at peace, since there is no front to describe", () => {
    const chips = buildWarModifiers({
      exhaustion: -1,
      effort: 0.5,
      contribution: 0.5,
      phase: "peace" as const,
    });
    expect(chips.map((m) => m.id)).toEqual(["war_exhaustion"]);
  });

  it("says exhaustion is recovering once the fighting has stopped", () => {
    const chips = buildWarModifiers({
      exhaustion: -1,
      effort: null,
      contribution: null,
      phase: "peace" as const,
    });
    expect(chips[0]!.label).toBe("War exhaustion (recovering)");
  });

  it("keeps the plain label while the war is still being fought", () => {
    const chips = buildWarModifiers({
      exhaustion: -1,
      effort: null,
      contribution: null,
      phase: "live" as const,
    });
    expect(chips[0]!.label).toBe("War exhaustion");
  });

  it("renders nothing at all for a country at peace that has fully healed", () => {
    expect(
      buildWarModifiers({
        exhaustion: 0,
        effort: null,
        contribution: null,
        phase: "peace" as const,
      })
    ).toEqual([]);
  });

  it("still shows a residue that has not finished healing", () => {
    const chips = buildWarModifiers({
      exhaustion: -0.4,
      effort: null,
      contribution: null,
      phase: "peace" as const,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]!.effect).toBe(-0.4);
  });

  it("omits alliance contribution when it does not apply", () => {
    expect(buildWarModifiers(live).map((m) => m.id)).not.toContain("alliance_contribution");
  });

  it("never emits a non finite effect", () => {
    const chips = buildWarModifiers({
      exhaustion: Number.NaN,
      effort: Number.NaN,
      contribution: Number.NaN,
      phase: "live" as const,
    });
    expect(chips).toEqual([]);
  });

  it("rounds each chip to a tenth so a repeating fraction cannot print in full", () => {
    const chips = buildWarModifiers({
      exhaustion: -1 / 3,
      effort: null,
      contribution: null,
      phase: "live" as const,
    });
    expect(chips[0]!.effect).toBe(-0.3);
  });
});

describe("nextControlSample", () => {
  it("takes a first sample when the conflict has never had one", () => {
    expect(nextControlSample(undefined, 100, 80)).toEqual({ turn: 100, control: 80 });
  });

  it("leaves a sample alone while it is still inside the momentum window", () => {
    expect(nextControlSample({ turn: 100, control: 90 }, 110, 80)).toBeUndefined();
  });

  it("refreshes a sample that has aged past the window", () => {
    expect(nextControlSample({ turn: 100, control: 90 }, 130, 80)).toEqual({
      turn: 130,
      control: 80,
    });
  });

  it("refreshes exactly at the window boundary", () => {
    expect(nextControlSample({ turn: 100, control: 90 }, 124, 80)).toEqual({
      turn: 124,
      control: 80,
    });
  });

  /** Clock changes (a reseed, an admin rewind) must not strand a future-dated sample. */
  it("replaces a sample stamped in the future", () => {
    expect(nextControlSample({ turn: 500, control: 90 }, 100, 80)).toEqual({
      turn: 100,
      control: 80,
    });
  });
});
