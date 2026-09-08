import { describe, expect, it } from "vitest";
import {
  AD_BONUS_CAP,
  campaignPrimaryScore,
  adExposure,
  addTurnoutBoost,
  adPurchaseCost,
  audienceTurnout,
  campaignResponse,
  canvassingBoost,
  decayTurnout,
  planAdPurchase,
  targetAudience,
  targetedAdBonuses,
  turnoutForElection,
  type CampaignCell,
  type TargetedAd,
} from "./rules";

const right = { economicLean: 3, socialLean: 3 };
const left = { economicLean: -3, socialLean: -3 };
const target = { dimension: "race", bucket: "white" };
const cells: CampaignCell[] = [
  {
    id: "aligned",
    share: 0.3,
    turnout: 50,
    ...right,
    buckets: { race: "white", wealth: "high", education: "low" },
    identities: { race: right, wealth: right, education: right },
  },
  {
    id: "conflicted",
    share: 0.3,
    turnout: 50,
    economicLean: -1,
    socialLean: -1,
    buckets: { race: "white", wealth: "low", education: "high" },
    identities: { race: right, wealth: left, education: left },
  },
  {
    id: "outside",
    share: 0.4,
    turnout: 50,
    ...right,
    buckets: { race: "other", wealth: "high", education: "low" },
    identities: { race: right, wealth: right, education: right },
  },
];

describe("coalition canvassing", () => {
  it("rewards close fit strongly, while distant candidates can still mobilize", () => {
    expect(canvassingBoost(right, right, false)).toBe(2);
    expect(canvassingBoost(right, left, false)).toBeLessThan(0.7);
    expect(canvassingBoost(right, left, false)).toBeGreaterThan(0);
    expect(canvassingBoost(right, right, true)).toBe(4);
    const extreme = { economicLean: 5, socialLean: 5 };
    expect(
      canvassingBoost(extreme, extreme, false) /
        canvassingBoost(extreme, { economicLean: -5, socialLean: -5 }, false)
    ).toBeGreaterThan(20);
    expect(addTurnoutBoost(0, 2, 10)).toBeGreaterThan(13);
    expect(addTurnoutBoost(0, 2, 10)).toBeLessThan(14);
  });

  it("can recover from suppression, and never exceeds either turnout cap", () => {
    expect(addTurnoutBoost(-20, 2)).toBe(-18);
    expect(addTurnoutBoost(20, -2)).toBe(18);
    expect(addTurnoutBoost(0, 4, 1000)).toBeLessThanOrEqual(20);
    expect(addTurnoutBoost(0, -4, 1000)).toBeGreaterThanOrEqual(-20);
  });

  it("skips malformed categories and values while decaying valid siblings", () => {
    const input = JSON.parse(
      '{"race":null,"age":12,"wealth":[],"education":{"college":10,"bad":null,"text":"4"}}'
    );
    expect(decayTurnout(input)).toEqual({ education: { college: 10 * 2 ** (-1 / 6) } });
    expect(input.race).toBeNull();
  });

  it("halves both positive and negative input deviations in six turns", () => {
    let modifiers: Record<string, Record<string, number>> = { race: { white: 10, other: -10 } };
    for (let turn = 0; turn < 6; turn++) modifiers = decayTurnout(modifiers);
    expect(modifiers.race.white).toBeCloseTo(5, 10);
    expect(modifiers.race.other).toBeCloseTo(-5, 10);
  });

  it("retains old race inputs and initializes new rules without mutating history", () => {
    const old = { modifiers: { race: { white: 1 } } };
    const dual = { ...old, campaignModifiers: { race: { white: 8 } } };
    expect(turnoutForElection(dual, {})).toBe(dual);
    expect(turnoutForElection(dual, { campaignRulesVersion: 1 })?.modifiers.race.white).toBe(8);
    expect(turnoutForElection(old, { campaignRulesVersion: 1 })?.modifiers.race.white).toBe(1);
    expect(dual.modifiers.race.white).toBe(1);
  });
});

describe("score-based primary integration", () => {
  it("expresses a capped weight bonus without changing the base score curve", () => {
    const adjusted = campaignPrimaryScore(70, 0.1, 8);
    const share = Math.exp((adjusted - 70) / 8) / (1 + Math.exp((adjusted - 70) / 8));
    expect(share).toBeCloseTo(1.1 / 2.1, 12);
    expect(campaignPrimaryScore(70, 0, 8)).toBe(70);
    expect(campaignPrimaryScore(70, 100, 8)).toBe(campaignPrimaryScore(70, 0.15, 8));
  });
});

describe("targeted ads", () => {
  it("reaches every matching identity, with weaker response for conflicting identities", () => {
    const audience = targetAudience(cells, target)!;
    expect(audience.share).toBeCloseTo(0.6);
    const response = cells.map((cell) => campaignResponse(right, cell, target, audience));
    expect(response[0]).toBeGreaterThan(response[1] * 2);
    expect(response[1]).toBeGreaterThan(0);
    expect(response[2]).toBe(0);
    expect(campaignResponse(left, cells[0], target, audience)).toBeLessThan(response[0]);
  });

  it("makes a dispersed audience less cohesive than one with a shared position", () => {
    const diverse = targetAudience(cells, target)!;
    const cohesive = targetAudience(
      cells.map((cell) => ({ ...cell, ...right })),
      target
    )!;
    expect(diverse.cohesion).toBeLessThan(cohesive.cohesion);
    expect(cohesive.cohesion).toBe(1);
  });

  it("handles arbitrary country dimensions and a single identity", () => {
    const cell: CampaignCell = {
      id: "x",
      share: 1,
      turnout: 60,
      ...right,
      buckets: { language: "a" },
      identities: { language: right },
    };
    const language = { dimension: "language", bucket: "a" };
    expect(campaignResponse(right, cell, language, targetAudience([cell], language)!)).toBe(1);
    expect(audienceTurnout([cell], language)).toBe(60);
    expect(targetAudience([cell], target)).toBeNull();
  });

  it("caps overlapping targets and limits effects to the purchased region", () => {
    const ads: TargetedAd[] = Object.entries(cells[0].buckets).map(([dimension, bucket]) => ({
      dimension,
      bucket,
      stateId: "A",
      exposure: 100,
      lastPurchaseTurn: 10,
      throughTurn: 10,
    }));
    const bonuses = targetedAdBonuses(cells, right, ads, "A", 10);
    expect(bonuses.aligned).toBeGreaterThan(0.1);
    expect(Math.max(...Object.values(bonuses))).toBeLessThanOrEqual(AD_BONUS_CAP);
    expect(Object.values(targetedAdBonuses(cells, right, ads, "B", 10))).toEqual([0, 0, 0]);
    expect(Object.values(targetedAdBonuses(cells, right, ads, "A", 9))).toEqual([0, 0, 0]);
  });

  it("makes prepaid flights equivalent to one manual buy each turn", () => {
    const flight = planAdPurchase([], { ...target, stateId: "A" }, 10, 6)!;
    let manual: TargetedAd[] = [];
    for (let turn = 10; turn < 16; turn++) {
      manual = planAdPurchase(manual, { ...target, stateId: "A" }, turn, 1)!;
      expect(adExposure(flight[0], turn)).toBeCloseTo(adExposure(manual[0], turn), 10);
      expect(planAdPurchase(flight, { ...target, stateId: "A" }, turn, 1)).toBeNull();
    }
    expect(adExposure(flight[0], 27)).toBeCloseTo(adExposure(flight[0], 15) / 2, 10);
    expect(planAdPurchase(flight, { ...target, stateId: "A" }, 16, 1)).not.toBeNull();
  });

  it("prices reach and the entire prepaid flight, independent of candidate alignment", () => {
    expect(adPurchaseCost(1_000_000, 0.5, 1)).toBe(1000);
    expect(adPurchaseCost(2_000_000, 0.5, 1)).toBe(2000);
    expect(adPurchaseCost(1_000_000, 0.5, 6)).toBe(6000);
  });
});
