import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import { planFloatAbsorptionAcrossFunds } from "./fundFloatAbsorptionPlan";
import { calculateHourlyPublicFloatAbsorptionCap } from "./publicFloatAbsorption";

function makeFund(slug: string, corpId: ObjectId, weight: number): IndexFund {
  return {
    _id: new ObjectId(),
    slug,
    name: slug,
    tickerSymbol: slug,
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1000,
    reserveUnits: 0,
    cashAnchor: 1_000_000,
    targetConstituents: [{ corporationId: corpId, targetWeight: weight, marketCapAnchor: 1 }],
    holdings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("planFloatAbsorptionAcrossFunds", () => {
  it("splits corp cap by target weight regardless of fund list order", () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      sharePrice: 10,
      totalShares: 1_000_000,
      publicFloat: 10_000,
      liquidCurrencyCode: "USD" as const,
    };
    const cap = calculateHourlyPublicFloatAbsorptionCap({
      totalShares: corp.totalShares,
      publicFloat: corp.publicFloat,
    });

    const fundA = makeFund("aaa_fund", corpId, 0.7);
    const fundB = makeFund("zzz_fund", corpId, 0.3);

    const forward = planFloatAbsorptionAcrossFunds(
      [fundA, fundB],
      [{ ...corp }],
      {},
      new Map([[corpId.toString(), cap]])
    );
    const reverse = planFloatAbsorptionAcrossFunds(
      [fundB, fundA],
      [{ ...corp }],
      {},
      new Map([[corpId.toString(), cap]])
    );

    const sumForFund = (
      plans: ReturnType<typeof planFloatAbsorptionAcrossFunds>,
      fundId: ObjectId
    ) =>
      plans
        .filter((p) => p.fundId.toString() === fundId.toString())
        .reduce((s, p) => s + p.filledShares, 0);

    expect(sumForFund(forward, fundA._id)).toBe(sumForFund(reverse, fundA._id));
    expect(sumForFund(forward, fundB._id)).toBe(sumForFund(reverse, fundB._id));
    expect(sumForFund(forward, fundA._id) + sumForFund(forward, fundB._id)).toBeLessThanOrEqual(
      cap
    );
  });
});
