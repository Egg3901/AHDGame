import { describe, expect, it } from "vitest";
import {
  DIRECT_EXECUTIVE_MANDATE_STRENGTH,
  MIN_MANDATE_STRENGTH,
  deriveElectoralMandate,
  mandateStrength,
} from "./electoralMandate";

describe("mandateStrength", () => {
  it("rises with the governing party's seat share and saturates at a full mandate", () => {
    expect(mandateStrength(0.1)).toBe(MIN_MANDATE_STRENGTH);
    expect(mandateStrength(0.4)).toBeGreaterThan(mandateStrength(0.3));
    expect(mandateStrength(0.55)).toBe(1);
    expect(mandateStrength(0.9)).toBe(1);
  });

  it("uses a fixed strength for a directly elected executive", () => {
    expect(mandateStrength(null)).toBe(DIRECT_EXECUTIVE_MANDATE_STRENGTH);
    expect(mandateStrength(Number.NaN)).toBe(DIRECT_EXECUTIVE_MANDATE_STRENGTH);
  });
});

describe("deriveElectoralMandate", () => {
  it("gives opposing platforms opposing domain mandates", () => {
    const left = deriveElectoralMandate({
      platform: { economic: -4, social: 0 },
      pledges: [],
      seatShare: 0.6,
    });
    const right = deriveElectoralMandate({
      platform: { economic: 4, social: 0 },
      pledges: [],
      seatShare: 0.6,
    });
    expect(left.domains.poverty).toBeGreaterThan(0);
    expect(left.domains.income_inequality).toBeGreaterThan(0);
    expect(right.domains.poverty).toBeLessThan(0);
    expect(right.domains.economic_growth).toBeGreaterThan(0);
    expect(left.domains.economic_growth).toBeUndefined();
  });

  it("adds manifesto pledges, mapped explicitly or by policy domain, once each", () => {
    const once = deriveElectoralMandate({
      platform: null,
      pledges: [{ id: "uk.nhs.universal", policyDomain: "health" }],
      seatShare: 0.6,
    });
    const duplicated = deriveElectoralMandate({
      platform: null,
      pledges: [
        { id: "uk.nhs.universal", policyDomain: "health" },
        { id: "uk.nhs.universal", policyDomain: "health" },
      ],
      seatShare: 0.6,
    });
    expect(once.domains.healthcare).toBeGreaterThan(0);
    expect(duplicated.domains).toEqual(once.domains);

    const fallback = deriveElectoralMandate({
      platform: null,
      pledges: [{ id: "xx.unmapped", policyDomain: "education" }],
      seatShare: 0.6,
    });
    expect(fallback.domains.education).toBeGreaterThan(0);
  });

  it("scales the same platform by the size of the win", () => {
    const platform = { economic: -5, social: 0 };
    const landslide = deriveElectoralMandate({ platform, pledges: [], seatShare: 0.6 });
    const narrow = deriveElectoralMandate({ platform, pledges: [], seatShare: 0.25 });
    expect(landslide.domains.poverty).toBeGreaterThan(narrow.domains.poverty);
  });

  it("stays bounded to [-1, 1] and ignores non-finite positions", () => {
    const stacked = deriveElectoralMandate({
      platform: { economic: -50, social: -50 },
      pledges: [
        { id: "uk.nhs.universal", policyDomain: "health" },
        { id: "uk.nhs.protect", policyDomain: "health" },
        { id: "a", policyDomain: "health" },
        { id: "b", policyDomain: "welfare" },
      ],
      seatShare: 1,
    });
    for (const value of Object.values(stacked.domains)) {
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
    const broken = deriveElectoralMandate({
      platform: { economic: Number.NaN, social: Number.POSITIVE_INFINITY },
      pledges: [],
      seatShare: 0.5,
    });
    expect(Object.values(broken.domains).every(Number.isFinite)).toBe(true);
  });

  it("is empty with no platform and no pledges", () => {
    expect(deriveElectoralMandate({ platform: null, pledges: [], seatShare: 0.5 }).domains).toEqual(
      {}
    );
  });
});
