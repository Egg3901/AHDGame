import { describe, it, expect } from "vitest";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "./countries";

describe("discordWebhookNote", () => {
  it("carries the shared-ECB note for DE and IE", () => {
    expect(getCountryConfig("DE").discordWebhookNote).toContain("ECB");
    expect(getCountryConfig("IE").discordWebhookNote).toContain("ECB");
  });

  it("carries the PBoC note for CN", () => {
    expect(getCountryConfig("CN").discordWebhookNote).toContain("PBoC");
  });

  it("is omitted for countries with no special institution copy", () => {
    expect(getCountryConfig("US").discordWebhookNote).toBeUndefined();
    expect(getCountryConfig("UK").discordWebhookNote).toBeUndefined();
    expect(getCountryConfig("JP").discordWebhookNote).toBeUndefined();
  });

  it("is a non-empty trimmed sentence wherever present", () => {
    for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
      const note = getCountryConfig(countryId).discordWebhookNote;
      if (note === undefined) continue;
      expect(note.trim(), `country ${countryId}`).toBe(note);
      expect(note.length, `country ${countryId}`).toBeGreaterThan(0);
    }
  });
});
