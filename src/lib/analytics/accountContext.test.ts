import { describe, expect, it } from "vitest";
import {
  accountEventProperties,
  getAnalyticsAccount,
  isAnalyticsGenerationCurrent,
  setAnalyticsAccount,
} from "./accountContext";

const now = Date.parse("2026-10-07T00:01:00Z");
describe("observed account cohort metadata", () => {
  it("uses UTC calendar age rather than a rolling 24-hour window", () => {
    expect(
      accountEventProperties(
        { id: "account", signupDate: "2026-10-06", isAdmin: false, isModerator: false },
        now
      )
    ).toEqual({
      account_created_date: "2026-10-06",
      account_age_days: 1,
      account_age_band: "days_1_6",
      account_role: "player",
    });
    expect(
      accountEventProperties({ id: "account", signupDate: "2026-10-07" }, now).account_age_band
    ).toBe("day_0");
    expect(
      accountEventProperties({ id: "account", signupDate: "2026-09-30" }, now).account_age_band
    ).toBe("days_7_plus");
  });
  it.each([undefined, "2026-02-30", "2026-10-08", "private text", "2026-10-07T00:00:00Z"])(
    "preserves an unknown cohort for unavailable or invalid date %s",
    (signupDate) => {
      expect(accountEventProperties({ id: "account", signupDate }, now)).toEqual({
        account_created_date: "unknown",
        account_age_days: "unknown",
        account_age_band: "unknown",
        account_role: "unknown",
      });
    }
  );
  it("requires explicit negative role flags to classify an ordinary player", () => {
    expect(accountEventProperties({ id: "account", isAdmin: false }, now).account_role).toBe(
      "unknown"
    );
    expect(accountEventProperties({ id: "account", isModerator: true }, now).account_role).toBe(
      "moderator"
    );
    expect(
      accountEventProperties({ id: "account", isAdmin: true, isModerator: true }, now).account_role
    ).toBe("admin");
  });
  it("invalidates old work even when an account switches away and back", () => {
    setAnalyticsAccount({ id: "first" });
    const { generation } = getAnalyticsAccount();
    setAnalyticsAccount({ id: "first", signupDate: "2026-10-07" });
    expect(isAnalyticsGenerationCurrent(generation)).toBe(true);
    setAnalyticsAccount({ id: "second" });
    setAnalyticsAccount({ id: "first" });
    expect(isAnalyticsGenerationCurrent(generation)).toBe(false);
  });
});
