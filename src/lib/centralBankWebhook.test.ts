import { describe, it, expect } from "vitest";
import { buildPrimeRateChangeEmbed } from "./centralBankWebhook";
import { DISCORD_COLORS } from "./discordWebhooks";

describe("buildPrimeRateChangeEmbed", () => {
  describe("rate cuts", () => {
    it("uses 'Rate Cut' title verb and green color", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "JP",
        previousRate: 0.5,
        newRate: 0.25,
        changedByName: "Hiroshi Tanaka",
      });
      expect(embed.title).toBe("Bank of Japan — Rate Cut");
      expect(embed.color).toBe(DISCORD_COLORS.primeRateCut);
    });

    it("uses 'lowered' verb in description with negative bps", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: 5.0,
        newRate: 4.75,
        changedByName: "Jerome Powell",
      });
      expect(embed.description).toBe("Prime rate lowered from 5.00% to 4.75% (-25 bps).");
    });
  });

  describe("rate hikes", () => {
    it("uses 'Rate Hike' title verb and red color", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "UK",
        previousRate: 4.0,
        newRate: 4.5,
        changedByName: "Andrew Bailey",
      });
      expect(embed.title).toBe("Bank of England — Rate Hike");
      expect(embed.color).toBe(DISCORD_COLORS.primeRateHike);
    });

    it("uses 'raised' verb in description with positive bps", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: 2.0,
        newRate: 4.0,
        changedByName: "Jerome Powell",
      });
      expect(embed.description).toBe("Prime rate raised from 2.00% to 4.00% (+200 bps).");
    });
  });

  describe("country bank names", () => {
    it.each([
      ["US", "Federal Reserve"],
      ["UK", "Bank of England"],
      ["DE", "European Central Bank"],
      ["JP", "Bank of Japan"],
    ] as const)("renders %s bank name as '%s'", (countryId, expectedName) => {
      const embed = buildPrimeRateChangeEmbed({
        countryId,
        previousRate: 2.0,
        newRate: 2.25,
        changedByName: "Test Chair",
      });
      expect(embed.title).toBe(`${expectedName} — Rate Hike`);
    });
  });

  describe("fields", () => {
    it("includes Chair, Change, and View fields by default", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: 2.0,
        newRate: 2.25,
        changedByName: "Jerome Powell",
      });
      const names = (embed.fields ?? []).map((f) => f.name);
      expect(names).toEqual(["Chair", "Change", "View"]);
    });

    it("Chair field shows the changedByName verbatim (admin label preserved)", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: 2.0,
        newRate: 2.25,
        changedByName: "Site Admin (admin)",
      });
      const chair = embed.fields?.find((f) => f.name === "Chair");
      expect(chair?.value).toBe("Site Admin (admin)");
      expect(chair?.inline).toBe(true);
    });

    it("Change field shows signed bps with inline=true", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: 2.0,
        newRate: 2.25,
        changedByName: "Jerome Powell",
      });
      const change = embed.fields?.find((f) => f.name === "Change");
      expect(change?.value).toBe("+25 bps");
      expect(change?.inline).toBe(true);
    });

    it("View field links to the currency central bank page", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "JP",
        previousRate: 0.5,
        newRate: 0.25,
        changedByName: "Hiroshi Tanaka",
      });
      const view = embed.fields?.find((f) => f.name === "View");
      expect(view?.value).toContain("/centralbank/jpy");
      expect(view?.value).toMatch(/^\[Open Central Bank\]\(.+\)$/);
      expect(view?.inline).toBe(true);
    });

    it("appends Reason field (non-inline) only when reason provided", () => {
      const withReason = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: 2.0,
        newRate: 2.25,
        changedByName: "Jerome Powell",
        reason: "Combat inflation.",
      });
      const reason = withReason.fields?.find((f) => f.name === "Reason");
      expect(reason?.value).toBe("Combat inflation.");
      expect(reason?.inline).toBeFalsy();

      const withoutReason = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: 2.0,
        newRate: 2.25,
        changedByName: "Jerome Powell",
      });
      expect(withoutReason.fields?.find((f) => f.name === "Reason")).toBeUndefined();
    });
  });

  describe("basis-point math", () => {
    it.each([
      [0.25, 0.5, "+25 bps"],
      [5.0, 4.75, "-25 bps"],
      [2.0, 4.0, "+200 bps"],
      [10.0, 9.0, "-100 bps"],
    ] as const)("%s%% -> %s%% renders as %s", (prev, next, expected) => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: prev,
        newRate: next,
        changedByName: "Test",
      });
      const change = embed.fields?.find((f) => f.name === "Change");
      expect(change?.value).toBe(expected);
    });
  });

  describe("footer and timestamp", () => {
    it("sets footer to 'A House Divided'", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: 2.0,
        newRate: 2.25,
        changedByName: "Test",
      });
      expect(embed.footer?.text).toBe("A House Divided");
    });

    it("sets timestamp to a valid ISO string", () => {
      const embed = buildPrimeRateChangeEmbed({
        countryId: "US",
        previousRate: 2.0,
        newRate: 2.25,
        changedByName: "Test",
      });
      expect(embed.timestamp).toBeDefined();
      expect(() => new Date(embed.timestamp!).toISOString()).not.toThrow();
    });
  });

  describe("invariants", () => {
    it("throws when previousRate equals newRate", () => {
      expect(() =>
        buildPrimeRateChangeEmbed({
          countryId: "US",
          previousRate: 2.0,
          newRate: 2.0,
          changedByName: "Test",
        })
      ).toThrow();
    });
  });
});
