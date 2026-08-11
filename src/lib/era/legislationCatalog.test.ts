import { describe, expect, it } from "vitest";
import {
  LEGISLATION_ERA,
  WINDOW_CONSTRAINT_WAIVERS,
  GATED_REVENUE_ACK,
  isLegislationTypeActive,
  isNewThisEra,
} from "./legislationCatalog";

describe("legislation era resolvers", () => {
  it("null year (flag off) ⇒ every type active, never new", () => {
    expect(isLegislationTypeActive("cn_common_prosperity", null)).toBe(true);
    expect(isLegislationTypeActive("us_medicaid", null)).toBe(true);
    expect(isNewThisEra("cn_common_prosperity", null)).toBe(false);
  });

  it("unknown / unlisted typeId ⇒ always active (fail-open)", () => {
    expect(isLegislationTypeActive("us_social_security", 1900)).toBe(true);
    expect(isLegislationTypeActive("totally_made_up", 1900)).toBe(true);
  });

  it("windowed type: inactive at from-1, active at from", () => {
    expect(LEGISLATION_ERA.cn_common_prosperity).toBe(2021);
    expect(isLegislationTypeActive("cn_common_prosperity", 2020)).toBe(false);
    expect(isLegislationTypeActive("cn_common_prosperity", 2021)).toBe(true);
    expect(isLegislationTypeActive("cn_common_prosperity", 2022)).toBe(true);
  });

  it("isNewThisEra true only within [from, from+2]", () => {
    expect(isNewThisEra("cn_common_prosperity", 2020)).toBe(false); // pre-window
    expect(isNewThisEra("cn_common_prosperity", 2021)).toBe(true); // from
    expect(isNewThisEra("cn_common_prosperity", 2023)).toBe(true); // from+2
    expect(isNewThisEra("cn_common_prosperity", 2024)).toBe(false); // from+3
  });

  it("waiver + ack sets reference real classified types", () => {
    expect(WINDOW_CONSTRAINT_WAIVERS.has("cn_internet_governance")).toBe(true);
    expect(GATED_REVENUE_ACK.has("ng_petroleum_profit_tax")).toBe(true);
  });

  it("era-universal types are explicit 'always', not gaps", () => {
    expect(LEGISLATION_ERA.us_social_security).toBe("always");
    expect(LEGISLATION_ERA.uk_universal_credit).toBe("always");
    expect(isLegislationTypeActive("us_social_security", 1900)).toBe(true);
  });
});
