import { describe, expect, it } from "vitest";
import {
  ALERT_QUEUE_MAX,
  EMPTY_ALERTS,
  buildNightFeed,
  buildNightView,
  callAlertsFrom,
  expireAlert,
  formatCountdown,
  formatEtClock,
  hasNight,
  ingestCalls,
  isNightWindow,
  msUntil,
  nightClockHour,
  nightProgressAt,
  nightStatusStyle,
  pollCloseLabel,
  unitNightStatus,
  type CallAlert,
} from "./nightModel";
import { CAND_A, CAND_B, nightFixture, settledFixture, unit } from "./nightTestData";

describe("nightStatusStyle", () => {
  it("paints every status and words it as a broadcast label", () => {
    expect(nightStatusStyle("polls_open")).toMatchObject({ paint: "grey", showNumbers: false });
    expect(nightStatusStyle("counting")).toMatchObject({ paint: "fog", label: "Polls closed" });
    expect(nightStatusStyle("too_early")).toMatchObject({
      paint: "fog",
      label: "Too early to call",
      showNumbers: false,
    });
    expect(nightStatusStyle("leaning")).toMatchObject({ paint: "lean", showNumbers: true });
    expect(nightStatusStyle("too_close")).toMatchObject({
      paint: "stripe",
      label: "Too close to call",
    });
    expect(nightStatusStyle("called")).toMatchObject({ paint: "called", label: "Projected" });
  });

  it("falls back to called/leaning/counting for units without a night status", () => {
    const base = unit("GA", "Georgia", 16, "called");
    expect(unitNightStatus({ ...base, nightStatus: undefined })).toBe("called");
    expect(unitNightStatus({ ...base, nightStatus: undefined, called: false })).toBe("leaning");
    expect(unitNightStatus({ ...base, nightStatus: undefined, called: false, totalVotes: 0 })).toBe(
      "counting"
    );
  });
});

describe("night clock", () => {
  it("puts the first poll closing at 7:00 PM and the last at 1:00 AM", () => {
    expect(formatEtClock(nightClockHour(0.06))).toBe("7:00 PM ET");
    expect(formatEtClock(nightClockHour(0.7))).toBe("1:00 AM ET");
  });

  it("runs the evening before the first close and the small hours after the last", () => {
    expect(nightClockHour(0)).toBeLessThan(19);
    expect(nightClockHour(1)).toBeGreaterThan(25);
    expect(nightClockHour(0.38)).toBeCloseTo(22, 5);
  });

  it("is monotonic and clamps outside the window", () => {
    expect(nightClockHour(-1)).toBe(nightClockHour(0));
    expect(nightClockHour(2)).toBe(nightClockHour(1));
    expect(nightClockHour(0.5)).toBeGreaterThan(nightClockHour(0.4));
  });

  it("formats wrapped hours and half hours", () => {
    expect(formatEtClock(24)).toBe("12:00 AM ET");
    expect(formatEtClock(19.5)).toBe("7:30 PM ET");
    expect(formatEtClock(12)).toBe("12:00 PM ET");
    expect(pollCloseLabel("OH")).toBe("7:30 PM ET");
    expect(pollCloseLabel("ME_CD1")).toBe("8:00 PM ET");
  });
});

describe("progress and countdown", () => {
  const election = { finalHour: { progress: 0.5, endsAt: "x" } };
  it("interpolates a live viewer between polls and caps the drift", () => {
    expect(nightProgressAt(election, 1000, 1000, 3_600_000, true)).toBe(0.5);
    expect(nightProgressAt(election, 1000, 1000 + 18_000, 3_600_000, true)).toBeCloseTo(0.505, 5);
    expect(nightProgressAt(election, 1000, 1000 + 600_000, 3_600_000, true)).toBeCloseTo(
      0.5 + 20_000 / 3_600_000,
      6
    );
  });
  it("does not interpolate a replay", () => {
    expect(nightProgressAt(election, 0, 99_999, 50_000, false)).toBe(0.5);
  });
  it("counts down to a poll closing in real time", () => {
    const night = {
      windowStart: "2026-10-08T05:00:00.000Z",
      windowEnd: "2026-10-08T06:00:00.000Z",
    };
    // Closing at 40 minutes into the hour, progress 0.5 (30 minutes): 10 minutes left.
    expect(msUntil("2026-10-08T05:40:00.000Z", night, 0.5, 3_600_000)).toBe(600_000);
    expect(msUntil("2026-10-08T05:10:00.000Z", night, 0.5, 3_600_000)).toBe(0);
    expect(formatCountdown(600_000)).toBe("10:00");
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
  });
});

describe("switchover gate", () => {
  it("only recognises a US presidential payload that carries a night", () => {
    expect(hasNight(nightFixture())).toBe(true);
    expect(hasNight(settledFixture())).toBe(false);
    expect(hasNight(null)).toBe(false);
    const nonUs = nightFixture();
    nonUs.election.countryId = "UK";
    expect(hasNight(nonUs)).toBe(false);
  });

  const detail = {
    countryId: "US",
    electionType: "president",
    isUpcoming: false,
    inPrimary: false,
    isEnded: false,
    endTurn: 36,
    gameState: { currentTurn: 35 },
  };
  it("starts watching from the last turn interval of a US general race", () => {
    expect(isNightWindow(detail)).toBe(true);
    expect(isNightWindow({ ...detail, gameState: { currentTurn: 34 } })).toBe(false);
    expect(isNightWindow({ ...detail, isEnded: true })).toBe(false);
    expect(isNightWindow({ ...detail, inPrimary: true })).toBe(false);
    expect(isNightWindow({ ...detail, countryId: "UK" })).toBe(false);
    expect(isNightWindow({ ...detail, electionType: "senate" })).toBe(false);
    expect(isNightWindow({ ...detail, endTurn: null })).toBe(false);
  });
});

describe("buildNightView", () => {
  it("reads called electoral votes from the night, not the candidate list", () => {
    const view = buildNightView(nightFixture());
    expect(view.settled).toBe(false);
    expect(view.candidates[0]).toMatchObject({ id: CAND_A, ev: 16 });
    expect(view.statesCalled).toBe(1);
    expect(view.evNeeded).toBe(270);
    expect(view.winnerId).toBeNull();
    expect(view.nextClose).toMatchObject({ label: "9:00 PM ET", stateNames: ["Texas"] });
  });

  it("lists too-close races first, then narrow uncalled leads, never called states", () => {
    const view = buildNightView(nightFixture());
    expect(view.keyRaces.map((r) => r.id)).toEqual(["NV"]);
    const data = nightFixture();
    data.units[1] = { ...data.units[1], leaderMarginPct: 2.5 };
    expect(buildNightView(data).keyRaces.map((r) => [r.id, r.status])).toEqual([
      ["NV", "too_close"],
      ["PA", "leaning"],
    ]);
  });

  it("settles on the real result with a winner", () => {
    const view = buildNightView(settledFixture());
    expect(view.settled).toBe(true);
    expect(view.reportingPct).toBe(100);
    expect(view.winnerId).toBe(CAND_A);
    expect(view.noMajority).toBe(false);
    expect(view.nextClose).toBeNull();
  });

  it("settles with no majority when nobody reaches the threshold", () => {
    const view = buildNightView(settledFixture(null));
    expect(view.winnerId).toBeNull();
    expect(view.noMajority).toBe(true);
  });
});

describe("feed", () => {
  it("folds simultaneous poll closings into one row and lists newest first", () => {
    const data = nightFixture();
    data.election.night!.feed = [
      { at: "2026-10-08T05:05:00.000Z", stateId: "GA", kind: "polls_close" },
      { at: "2026-10-08T05:05:10.000Z", stateId: "SC", kind: "polls_close" },
      { at: "2026-10-08T05:20:00.000Z", stateId: "GA", kind: "call", candidateId: CAND_A },
    ];
    data.units.push(unit("SC", "South Carolina", 9, "leaning"));
    const feed = buildNightFeed(data);
    expect(feed.map((f) => f.kind)).toEqual(["call", "polls_close"]);
    expect(feed[0].text).toBe("Projected: Alex Morrow wins Georgia (16 EV)");
    expect(feed[1].text).toBe("Polls closed in Georgia and South Carolina");
    expect(feed[1].clock).toBe("7:00 PM ET");
  });

  it("is empty once the night is over", () => {
    expect(buildNightFeed(settledFixture())).toEqual([]);
  });
});

describe("call alert queue", () => {
  const call = (stateId: string): CallAlert => ({
    key: `call:${stateId}`,
    stateId,
    stateName: stateId,
    candidateId: CAND_A,
    candidateName: "Alex Morrow",
    color: "#3B82F6",
    ev: 5,
  });

  it("derives one alert per call event", () => {
    const alerts = callAlertsFrom(nightFixture(), nightFixture().election.night!.feed);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ stateId: "GA", candidateName: "Alex Morrow", ev: 16 });
  });

  it("gives a late joiner no alerts for calls already made", () => {
    const joined = ingestCalls(EMPTY_ALERTS, [call("GA"), call("PA"), call("OH")]);
    expect(joined.active).toBeNull();
    expect(joined.queue).toEqual([]);
    expect(joined.seen).toHaveLength(3);
  });

  it("alerts each new call once", () => {
    let s = ingestCalls(EMPTY_ALERTS, [call("GA")]);
    s = ingestCalls(s, [call("GA"), call("PA")]);
    expect(s.active?.stateId).toBe("PA");
    // The same poll again changes nothing.
    expect(ingestCalls(s, [call("GA"), call("PA")])).toBe(s);
    s = expireAlert(s);
    expect(s.active).toBeNull();
    expect(ingestCalls(s, [call("GA"), call("PA")]).active).toBeNull();
  });

  it("queues a burst in order behind the alert on screen", () => {
    let s = ingestCalls(EMPTY_ALERTS, []);
    s = ingestCalls(s, [call("A1"), call("A2"), call("A3")]);
    expect(s.active?.stateId).toBe("A1");
    expect(s.queue.map((c) => c.stateId)).toEqual(["A2", "A3"]);
    s = expireAlert(s);
    expect(s.active?.stateId).toBe("A2");
    s = expireAlert(expireAlert(s));
    expect(s.active).toBeNull();
  });

  it("drops the oldest waiting alerts instead of replaying a long backlog", () => {
    let s = ingestCalls(EMPTY_ALERTS, []);
    const many = Array.from({ length: 10 }, (_, i) => call(`S${i}`));
    s = ingestCalls(s, many);
    expect(1 + s.queue.length).toBeLessThanOrEqual(ALERT_QUEUE_MAX);
    expect(s.queue.at(-1)?.stateId).toBe("S9");
  });
});

describe("candidate colours", () => {
  it("keeps the two tickets' called totals apart", () => {
    const data = nightFixture();
    data.election.night!.calledEv = { [CAND_A]: 100, [CAND_B]: 120 };
    const view = buildNightView(data);
    expect(view.candidates.map((c) => [c.id, c.ev])).toEqual([
      [CAND_B, 120],
      [CAND_A, 100],
    ]);
  });
});
