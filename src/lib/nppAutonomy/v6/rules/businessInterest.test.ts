import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { BillProvision } from "@/lib/db/types/legislation";
import {
  BUSINESS_INTEREST_FORCE,
  buildNppBusinessStakes,
  businessInterestForce,
  hasBusinessProvision,
} from "./businessInterest";

const stakes = (sectors: Record<string, number>, corps: Record<string, number> = {}) => ({
  sectors: new Map(Object.entries(sectors)),
  corporations: new Map(Object.entries(corps)),
});
const p = (provision: Record<string, unknown>) => provision as unknown as BillProvision;

describe("NPP engine 6.8 business interest", () => {
  it("backs a subsidy for its own sector and opposes ending one", () => {
    const s = stakes({ steel: 1 });
    expect(
      businessInterestForce(
        [p({ type: "subsidy", scopeType: "sector", targetSectorType: "steel" })],
        s
      )
    ).toBe(40);
    expect(
      businessInterestForce(
        [p({ type: "end_subsidy", scopeType: "sector", targetSectorType: "steel" })],
        s
      )
    ).toBe(-40);
  });

  it("is indifferent to other sectors and to policy bills", () => {
    const s = stakes({ steel: 1 });
    expect(
      businessInterestForce(
        [p({ type: "subsidy", scopeType: "sector", targetSectorType: "oil" })],
        s
      )
    ).toBe(0);
    expect(
      businessInterestForce(
        [p({ legislationTypeId: "x", policyOptionId: "y", effectDirection: 1 })],
        s
      )
    ).toBe(0);
  });

  it("opposes a tariff aimed at its own company and nationalisation of it", () => {
    const corp = new ObjectId();
    const s = stakes({}, { [corp.toString()]: 0.5 });
    expect(
      businessInterestForce(
        [p({ type: "tariff", scopeType: "corporation", targetCorporationId: corp })],
        s
      )
    ).toBe(-20);
    expect(businessInterestForce([p({ type: "nationalize", targetCorporationId: corp })], s)).toBe(
      -20
    );
  });

  it("caps the force", () => {
    const s = stakes({ steel: 1, oil: 1 });
    const both = [
      p({ type: "subsidy", scopeType: "sector", targetSectorType: "steel" }),
      p({ type: "subsidy", scopeType: "sector", targetSectorType: "oil" }),
    ];
    expect(businessInterestForce(both, s)).toBe(BUSINESS_INTEREST_FORCE);
  });

  it("builds stakes from CEO seats and holdings of at least 1%", () => {
    const ceo = new ObjectId();
    const holder = new ObjectId();
    const small = new ObjectId();
    const corpId = new ObjectId();
    const out = buildNppBusinessStakes(
      [
        {
          _id: corpId,
          ceoId: ceo,
          totalShares: 1000,
          shareholders: [
            { nppId: holder, shares: 10 },
            { nppId: small, shares: 9 },
          ],
        },
      ],
      new Map([[corpId.toString(), ["steel"]]]),
      new Set([ceo.toString(), holder.toString(), small.toString()])
    );
    expect(out.get(ceo.toString())?.sectors.get("steel")).toBe(1);
    expect(out.get(holder.toString())?.sectors.get("steel")).toBe(0.5);
    expect(out.has(small.toString())).toBe(false);
  });

  it("recognises the provisions it reads", () => {
    expect(hasBusinessProvision([p({ type: "tariff", scopeType: "sector" })])).toBe(true);
    expect(hasBusinessProvision([p({ legislationTypeId: "x" })])).toBe(false);
  });
});
