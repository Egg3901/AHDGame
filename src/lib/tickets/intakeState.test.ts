import { describe, expect, it } from "vitest";
import { intakeInteractionSchema, intakePageUrl, intakeResponseFields } from "./intakeState";
describe("ticket intake corrections", () => {
  it.each([
    "https://example.com/market",
    "https://ahousedividedgame.com/account",
    "https://someone@ahousedividedgame.com/market",
    "http://ahousedividedgame.com/market",
  ])("rejects unsafe page %s", (value) => expect(intakePageUrl(value)).toBeNull());
  it("accepts a menu description and waits only on explicitly declined context", () => {
    const response = intakeInteractionSchema.parse({
      interactionId: "reply",
      reporterDiscordId: "reporter",
      action: "change_page",
      value: "Corporation menu, financials",
    });
    expect(intakeResponseFields(response)).toMatchObject({
      "intake.pageDescription": "Corporation menu, financials",
      "intake.candidatePageUrl": null,
      "intake.pageConfirmed": true,
      "intake.awaitingReply": null,
    });
  });
  it("requires a correction and rejects an external URL", () => {
    for (const value of [undefined, "https://example.com/login"])
      expect(
        intakeInteractionSchema.safeParse({
          interactionId: "reply",
          reporterDiscordId: "reporter",
          action: "change_page",
          value,
        }).success
      ).toBe(false);
  });
});
