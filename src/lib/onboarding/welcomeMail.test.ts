import { describe, expect, it } from "vitest";
import { buildWelcomeMailBody } from "./welcomeMail";

const BASE = {
  countryId: "US",
  startingFunds: 250_000,
  startingActions: 5,
  rewardAmount: 50_000,
  turnLengthMinutes: 60,
};

describe("buildWelcomeMailBody", () => {
  it("labels anchor amounts with ₳ when no home currency is given (legacy)", () => {
    const body = buildWelcomeMailBody(BASE);

    expect(body).toContain("₳250,000 in campaign funds");
    expect(body).toContain("pays out ₳50,000");
    expect(body).toContain("every hour");
  });

  it("names the local credited balances in the actual home currency (2027 euro member)", () => {
    const body = buildWelcomeMailBody({
      ...BASE,
      countryId: "FR",
      currencyCode: "EUR",
      localStartingFunds: 230_000,
      localRewardAmount: 46_000,
    });

    expect(body).toContain("€230,000 in campaign funds");
    expect(body).toContain("pays out €46,000");
    expect(body).not.toContain("₳");
  });

  it("keeps non-euro labels on the national symbol at the local balance", () => {
    const body = buildWelcomeMailBody({
      ...BASE,
      countryId: "UK",
      currencyCode: "GBP",
      localStartingFunds: 187_500,
      localRewardAmount: 37_500,
    });

    expect(body).toContain("£187,500 in campaign funds");
    expect(body).toContain("pays out £37,500");
  });

  it("falls back to anchor amounts when locals are missing", () => {
    const body = buildWelcomeMailBody({ ...BASE, currencyCode: "EUR" });

    expect(body).toContain("€250,000 in campaign funds");
    expect(body).toContain("pays out €50,000");
  });
});
