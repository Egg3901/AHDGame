import { describe, expect, it } from "vitest";
import { bankFailurePoliticalEffects, type BankFailurePoliticalEvent } from "./failurePolitics";
import { evalNode } from "@/lib/metricEngine/coexistence";
import { consumerConfidenceNode } from "@/lib/metricEngine/registry/economic";
const event: BankFailurePoliticalEvent = {
  _id: "bank:1",
  bankId: "bank",
  charteredTurn: 1,
  countryId: "US",
  currency: "USD",
  paidTurn: 20,
  depositExposure: 1_000,
  insurancePaid: 100,
  taxpayerPaid: 200,
  gdp: 100_000,
};
describe("funded bank failure politics", () => {
  it("uses same-currency GDP fractions and deterministic one-year decay", () => {
    expect(bankFailurePoliticalEffects([event], "US", 20)).toEqual({
      approval: -0.2,
      consumerConfidence: -1,
    });
    expect(bankFailurePoliticalEffects([event], "US", 44)).toEqual({
      approval: -0.1,
      consumerConfidence: -0.5,
    });
    expect(bankFailurePoliticalEffects([event], "US", 68)).toEqual({
      approval: 0,
      consumerConfidence: 0,
    });
  });
  it("does not double-count epoch receipts or events in other countries or future turns", () => {
    expect(bankFailurePoliticalEffects([event, event], "US", 20)).toEqual(
      bankFailurePoliticalEffects([event], "US", 20)
    );
    expect(bankFailurePoliticalEffects([event], "UK", 20)).toEqual({
      approval: 0,
      consumerConfidence: 0,
    });
    expect(bankFailurePoliticalEffects([event], "US", 19)).toEqual({
      approval: 0,
      consumerConfidence: 0,
    });
  });
  it("caps aggregate systemic costs and ignores corrupt GDP and payouts", () => {
    const large = { ...event, depositExposure: 1e9, taxpayerPaid: 1e9 };
    expect(bankFailurePoliticalEffects([large, { ...large, _id: "bank:2" }], "US", 20)).toEqual({
      approval: -3,
      consumerConfidence: -10,
    });
    expect(bankFailurePoliticalEffects([{ ...event, gdp: NaN }], "US", 20)).toEqual({
      approval: 0,
      consumerConfidence: 0,
    });
    expect(
      bankFailurePoliticalEffects([{ ...event, taxpayerPaid: NaN, depositExposure: -1 }], "US", 20)
    ).toEqual({ approval: 0, consumerConfidence: 0 });
  });
  it("is invariant when all native-currency money and GDP are scaled together", () => {
    expect(
      bankFailurePoliticalEffects(
        [
          {
            ...event,
            gdp: event.gdp * 100,
            depositExposure: event.depositExposure * 100,
            taxpayerPaid: event.taxpayerPaid * 100,
          },
        ],
        "US",
        20
      )
    ).toEqual(bankFailurePoliticalEffects([event], "US", 20));
  });
  it("feeds the real confidence node target and cannot accumulate on replay", () => {
    const nudge = bankFailurePoliticalEffects([event], "US", 20).consumerConfidence;
    const ctx = {
      current: { "economic.unemploymentRate": 4.5, "economic.costOfLivingIndex": 100 },
      prev: {},
      prevSimBaseline: { "economic.consumerConfidence": 60 },
      providers: {},
      spending: {},
      policyValue: 60,
      targetNudge: nudge,
    };
    const baseline = evalNode(consumerConfidenceNode, { ...ctx, targetNudge: 0 }, "s1");
    const result = evalNode(consumerConfidenceNode, ctx, "s1");
    expect(result.value).toBeCloseTo(baseline.value - 0.2, 3);
    expect(evalNode(consumerConfidenceNode, ctx, "s1")).toEqual(result);
  });
});
