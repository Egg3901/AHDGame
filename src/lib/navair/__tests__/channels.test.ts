import { describe, it, expect } from "vitest";
import {
  contestTarget,
  advanceChannel,
  advanceChannels,
  emptyChannels,
  sideChannel,
  channelKey,
  CHANNEL_RATES,
} from "../channels";
import type { RegionChannels } from "../types";
import type { CountryId } from "@/lib/constants/countries";

describe("contestTarget", () => {
  it("gives parity 50, so an even contest is genuinely even", () => {
    expect(contestTarget({ own: 100, hostile: 100 })).toBe(50);
  });

  it("gives uncontested presence the full region", () => {
    expect(contestTarget({ own: 100, hostile: 0 })).toBe(100);
  });

  it("gives absence nothing, whatever the enemy is doing", () => {
    // The point: leaving costs you the region. It does not merely stop you gaining.
    expect(contestTarget({ own: 0, hostile: 0 })).toBe(0);
    expect(contestTarget({ own: 0, hostile: 500 })).toBe(0);
  });

  it("scales with share rather than snapping to a winner", () => {
    const weak = contestTarget({ own: 25, hostile: 75 });
    const strong = contestTarget({ own: 75, hostile: 25 });
    expect(weak).toBe(25);
    expect(strong).toBe(75);
    // A losing side still holds something, which a binary winner model cannot express.
    expect(weak).toBeGreaterThan(0);
  });
});

describe("advanceChannel", () => {
  it("decays faster than it builds, so holding station is a commitment", () => {
    expect(CHANNEL_RATES.seaControl.decay).toBeGreaterThan(CHANNEL_RATES.seaControl.build);
  });

  it("never overshoots its target in either direction", () => {
    expect(advanceChannel(48, 50, "seaControl")).toBe(50);
    expect(advanceChannel(52, 50, "seaControl")).toBe(50);
  });

  it("takes several turns to cross a large gap", () => {
    let v = 0;
    const turns: number[] = [];
    for (let i = 0; i < 5; i++) {
      v = advanceChannel(v, 100, "seaControl");
      turns.push(v);
    }
    // Not instant, and monotonically rising: a player can watch it happen.
    expect(turns[0]).toBeLessThan(100);
    expect(turns).toEqual([...turns].sort((a, b) => a - b));
    expect(v).toBeGreaterThan(turns[0]);
  });

  it("clamps to 0..100", () => {
    expect(advanceChannel(0, 0, "seaControl")).toBe(0);
    expect(advanceChannel(100, 100, "airSuperiority")).toBe(100);
  });

  it("costs more to regain than to lose: one turn away is not one turn back", () => {
    const held = 100;
    const afterLeaving = advanceChannel(held, 0, "seaControl");
    const backOnStation = advanceChannel(afterLeaving, 100, "seaControl");
    expect(backOnStation).toBeLessThan(held);
  });
});

describe("advanceChannels", () => {
  it("decays a lost contact by a band rather than blanking it", () => {
    const prev: RegionChannels = {
      airSuperiority: 0,
      seaControl: 0,
      detection: 3,
      updatedTurn: 1,
    };
    const next = advanceChannels(
      prev,
      { air: { own: 0, hostile: 0 }, sea: { own: 0, hostile: 0 } },
      0,
      2
    );
    expect(next.detection).toBe(3 - CHANNEL_RATES.detection.decay);
    expect(next.detection).toBeGreaterThan(0);
  });

  it("takes live detection immediately when it is better than the decayed memory", () => {
    const prev = { ...emptyChannels(1), detection: 1 };
    const next = advanceChannels(
      prev,
      { air: { own: 0, hostile: 0 }, sea: { own: 0, hostile: 0 } },
      3,
      2
    );
    expect(next.detection).toBe(3);
  });

  it("stamps the turn so a stale row is detectable", () => {
    const next = advanceChannels(
      emptyChannels(1),
      { air: { own: 1, hostile: 0 }, sea: { own: 1, hostile: 0 } },
      0,
      7
    );
    expect(next.updatedTurn).toBe(7);
  });
});

describe("sideChannel", () => {
  const US = "US" as CountryId;
  const MINOR = "BE" as CountryId;

  it("takes the strongest member, not the average", () => {
    // A strong power must not be dragged down by taking on a weak ally. Averaging here
    // would make joining a coalition actively harm the side that holds the sky.
    const channels = new Map<string, RegionChannels>([
      [channelKey(US, "nat"), { ...emptyChannels(1), airSuperiority: 80 }],
      [channelKey(MINOR, "nat"), { ...emptyChannels(1), airSuperiority: 10 }],
    ]);
    expect(sideChannel(channels, [US, MINOR], "nat", "airSuperiority")).toBe(80);
  });

  it("returns 0 for a region the side has never contested", () => {
    expect(sideChannel(new Map(), [US], "spa", "seaControl")).toBe(0);
  });
});
