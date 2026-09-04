import { describe, it, expect } from "vitest";
import { buildGeneralHeadline } from "./generalHeadline";

const DASHES = /[–—]/;

describe("buildGeneralHeadline", () => {
  it("says the leader has cleared the threshold once they reach it", () => {
    const { headline } = buildGeneralHeadline({
      leaderName: "Frontrunner",
      leaderEv: 276,
      runnerUpEv: 251,
      threshold: 270,
      outstandingEv: 11,
      popularMarginPp: 1.6,
    });
    expect(headline).toContain("Frontrunner");
    expect(headline).toContain("270");
    expect(headline).toMatch(/clears/i);
  });

  it("says the leader is short while they are under it", () => {
    const { headline } = buildGeneralHeadline({
      leaderName: "Frontrunner",
      leaderEv: 240,
      runnerUpEv: 230,
      threshold: 270,
      outstandingEv: 68,
      popularMarginPp: 0.4,
    });
    expect(headline).toMatch(/short of/i);
    expect(headline).toContain("240");
  });

  it("reads a level race as deadlocked", () => {
    const { headline } = buildGeneralHeadline({
      leaderName: "Frontrunner",
      leaderEv: 269,
      runnerUpEv: 269,
      threshold: 270,
      outstandingEv: 0,
      popularMarginPp: 0.1,
    });
    expect(headline).toMatch(/deadlock/i);
    expect(headline).not.toMatch(/clears/i);
  });

  it("counts outstanding votes in the standfirst only when some remain", () => {
    const withOutstanding = buildGeneralHeadline({
      leaderName: "Frontrunner",
      leaderEv: 276,
      runnerUpEv: 251,
      threshold: 270,
      outstandingEv: 11,
      popularMarginPp: 1.6,
    });
    expect(withOutstanding.standfirst).toContain("11");

    const settled = buildGeneralHeadline({
      leaderName: "Frontrunner",
      leaderEv: 300,
      runnerUpEv: 238,
      threshold: 270,
      outstandingEv: 0,
      popularMarginPp: 6,
    });
    expect(settled.standfirst).not.toContain("outstanding");
  });

  it("calls a sub-two-point popular vote close", () => {
    const { standfirst } = buildGeneralHeadline({
      leaderName: "Frontrunner",
      leaderEv: 276,
      runnerUpEv: 251,
      threshold: 270,
      outstandingEv: 11,
      popularMarginPp: 1.6,
    });
    expect(standfirst).toMatch(/two points|1.6/i);
  });

  it("handles a race with no tally yet without inventing a leader", () => {
    const { headline, standfirst } = buildGeneralHeadline({
      leaderName: null,
      leaderEv: 0,
      runnerUpEv: 0,
      threshold: 270,
      outstandingEv: 538,
      popularMarginPp: 0,
    });
    expect(headline).toMatch(/no votes|not yet|counting/i);
    expect(standfirst.length).toBeGreaterThan(0);
  });

  it("never emits an em or en dash", () => {
    const cases = [
      {
        leaderName: "A",
        leaderEv: 276,
        runnerUpEv: 251,
        threshold: 270,
        outstandingEv: 11,
        popularMarginPp: 1.6,
      },
      {
        leaderName: "A",
        leaderEv: 240,
        runnerUpEv: 230,
        threshold: 270,
        outstandingEv: 68,
        popularMarginPp: 0.4,
      },
      {
        leaderName: "A",
        leaderEv: 269,
        runnerUpEv: 269,
        threshold: 270,
        outstandingEv: 0,
        popularMarginPp: 0,
      },
      {
        leaderName: null,
        leaderEv: 0,
        runnerUpEv: 0,
        threshold: 270,
        outstandingEv: 538,
        popularMarginPp: 0,
      },
    ];
    for (const c of cases) {
      const { headline, standfirst } = buildGeneralHeadline(c);
      expect(headline).not.toMatch(DASHES);
      expect(standfirst).not.toMatch(DASHES);
    }
  });

  it("uses the threshold it is given rather than assuming 270", () => {
    // A different apportionment preset moves the majority.
    const { headline } = buildGeneralHeadline({
      leaderName: "Frontrunner",
      leaderEv: 200,
      runnerUpEv: 180,
      threshold: 195,
      outstandingEv: 0,
      popularMarginPp: 3,
    });
    expect(headline).toContain("195");
    expect(headline).not.toContain("270");
  });
});
