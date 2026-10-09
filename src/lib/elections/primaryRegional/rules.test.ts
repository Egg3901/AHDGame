import { describe, expect, it } from "vitest";
import {
  HOME_DIVISION_BONUS_PRIMARY,
  PRIMARY_STATE_SWING_SIGMA,
  PRIMARY_STATE_SWING_Z_CAP,
  US_CENSUS_DIVISION,
  distributePrimaryCounties,
  hashNormal,
  hashUnit,
  homeDivisionMultiplier,
  primaryStateSwing,
  sharpenPrimaryAppeal,
} from "./rules";

describe("primary state swing", () => {
  it("is a pure function of race, state and candidate", () => {
    expect(primaryStateSwing("e1", "OH", "c1")).toBe(primaryStateSwing("e1", "OH", "c1"));
    expect(primaryStateSwing("e1", "OH", "c1")).not.toBe(primaryStateSwing("e1", "PA", "c1"));
    expect(primaryStateSwing("e1", "OH", "c1")).not.toBe(primaryStateSwing("e2", "OH", "c1"));
  });

  it("is off without a seed or a state", () => {
    expect(primaryStateSwing(undefined, "OH", "c1")).toBe(1);
    expect(primaryStateSwing("e1", undefined, "c1")).toBe(1);
    expect(primaryStateSwing("e1", "OH", "c1", 0)).toBe(1);
  });

  it("stays inside the capped band", () => {
    const hi = Math.exp(PRIMARY_STATE_SWING_SIGMA * PRIMARY_STATE_SWING_Z_CAP);
    for (const st of Object.keys(US_CENSUS_DIVISION)) {
      for (const c of ["a", "b", "c", "d"]) {
        const m = primaryStateSwing("race", st, c);
        expect(m).toBeLessThanOrEqual(hi + 1e-12);
        expect(m).toBeGreaterThanOrEqual(1 / hi - 1e-12);
      }
    }
  });

  it("centres on 1 and spreads about sigma across many draws", () => {
    const logs: number[] = [];
    for (let i = 0; i < 4000; i++) logs.push(Math.log(primaryStateSwing("race", `S${i}`, "c")));
    const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / logs.length);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(sd).toBeGreaterThan(PRIMARY_STATE_SWING_SIGMA * 0.85);
    expect(sd).toBeLessThan(PRIMARY_STATE_SWING_SIGMA * 1.1);
  });

  it("draws uniforms strictly inside (0, 1) and finite normals", () => {
    for (let i = 0; i < 500; i++) {
      const u = hashUnit(`k${i}`);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(Number.isFinite(hashNormal(`k${i}`))).toBe(true);
    }
  });
});

describe("appeal sharpening", () => {
  it("widens the ratio between a better and a worse fit", () => {
    expect(sharpenPrimaryAppeal(40) / sharpenPrimaryAppeal(20)).toBeGreaterThan(40 / 20);
  });

  it("keeps non-positive appeal at zero", () => {
    expect(sharpenPrimaryAppeal(0)).toBe(0);
    expect(sharpenPrimaryAppeal(-3)).toBe(0);
  });
});

describe("home division pull", () => {
  it("applies across the home state's census division", () => {
    expect(homeDivisionMultiplier("OH", "MI")).toBe(1 + HOME_DIVISION_BONUS_PRIMARY);
  });

  it("leaves the home state to its own bonus and other divisions alone", () => {
    expect(homeDivisionMultiplier("OH", "OH")).toBe(1);
    expect(homeDivisionMultiplier("OH", "CA")).toBe(1);
    expect(homeDivisionMultiplier(null, "OH")).toBe(1);
  });

  it("covers all fifty states and DC", () => {
    expect(Object.keys(US_CENSUS_DIVISION)).toHaveLength(51);
  });
});

describe("primary county spread", () => {
  const counties = [
    { id: "L", name: "Left", electorate: 100, lean: -30 },
    { id: "M", name: "Middle", electorate: 100, lean: 0 },
    { id: "R", name: "Right", electorate: 100, lean: 30 },
  ];
  const votes = { left: 600, right: 400 };
  const econ = { left: -3, right: 0 };

  it("adds every candidate's counties back up to their state total", () => {
    const rows = distributePrimaryCounties(counties, votes, econ, "race", "OH");
    for (const id of Object.keys(votes)) {
      const sum = rows.reduce((s, r) => s + r.votes[id], 0);
      expect(Math.abs(sum - votes[id as keyof typeof votes])).toBeLessThanOrEqual(rows.length);
    }
  });

  it("does better in counties that lean the candidate's way", () => {
    const rows = distributePrimaryCounties(counties, votes, econ, "race", "OH");
    const share = (r: (typeof rows)[number]) => r.votes.left / (r.votes.left + r.votes.right);
    const byId = Object.fromEntries(rows.map((r) => [r.id, share(r)]));
    expect(byId.L).toBeGreaterThan(byId.M);
    expect(byId.M).toBeGreaterThan(byId.R);
  });

  it("is deterministic", () => {
    expect(distributePrimaryCounties(counties, votes, econ, "race", "OH")).toEqual(
      distributePrimaryCounties(counties, votes, econ, "race", "OH")
    );
  });

  it("returns nothing for an empty state", () => {
    expect(distributePrimaryCounties(counties, {}, econ, "race", "OH")).toEqual([]);
  });
});
