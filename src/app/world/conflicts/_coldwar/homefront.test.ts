import { describe, it, expect } from "vitest";
import { HOMEFRONT } from "./homefront";

const W = HOMEFRONT.west;
const E = HOMEFRONT.east;
const none = {};

describe("West · The Home Front", () => {
  it("baseline at DEFCON 3 reads MIXED approval", () => {
    const m = W.compute(none, 3, 0);
    expect(m.appr).toBe(46);
    expect(m.hawk).toBe(42);
    expect(m.mood).toBe("WATCHFUL");
    expect(W.bigStat(m).tier).toBe("MIXED");
  });
  it("hardline rearmament swings hawks up, doves down, misery up", () => {
    const m = W.compute({ hardline: true }, 3, 0);
    expect(m.hawk).toBe(60);
    expect(m.dove).toBe(30);
    expect(m.misery).toBe(26);
    expect(m.appr).toBe(48); // 50 − misery drag 2.4, rounded
  });
  it("DEFCON 2 alarms the public and rallies the flag", () => {
    const m = W.compute(none, 2, 0);
    expect(m.mood).toBe("ALARMED");
    expect(m.appr).toBe(49);
  });
  it("a CRISIS reading flips the header to red", () => {
    const m = W.compute({ coups: true, firewall: true, basing: true }, 3, 0);
    expect(W.bigStat(m).tier).toBe("CRISIS");
  });
});

describe("East · The Politburo", () => {
  it("baseline at DEFCON 3 reads CONTESTED confidence", () => {
    const m = E.compute(none, 3, 0);
    expect(m.conf).toBe(50);
    expect(m.plan).toBe(96);
    expect(m.mood).toBe("VIGILANT");
    expect(E.bigStat(m).tier).toBe("CONTESTED");
  });
  it("the Afghan intervention drains the plan and confidence", () => {
    const m = E.compute({ afghan: true }, 3, 0);
    expect(m.plan).toBe(91);
    expect(m.short).toBe(40);
    expect(m.hard).toBe(56);
    expect(m.conf).toBe(43);
    expect(E.bigStat(m).tier).toBe("VULNERABLE");
  });
  it("détente lifts the plan and reformers", () => {
    const m = E.compute({ detente: true }, 3, 0);
    expect(m.plan).toBe(99);
    expect(m.conf).toBe(54);
  });
});

describe("config shape", () => {
  it("each side has 5 postures and an 8-PC address", () => {
    for (const cfg of [W, E]) {
      expect(cfg.postures).toHaveLength(5);
      expect(cfg.addressLabel).toContain("8 PC");
    }
  });
  it("the strip has 4 metrics West / 5 East", () => {
    expect(W.strip(W.compute(none, 3, 0), 3, 60)).toHaveLength(4);
    expect(E.strip(E.compute(none, 3, 0), 3, 60)).toHaveLength(5);
  });
});
