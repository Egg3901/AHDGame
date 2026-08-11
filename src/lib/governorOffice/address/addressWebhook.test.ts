import { describe, expect, it } from "vitest";
import { buildNationalAddressEmbed } from "./addressWebhook";
import { DISCORD_COLORS } from "@/lib/discordWebhooks";

describe("buildNationalAddressEmbed", () => {
  it("titles with the country's national address name and the LARP title", () => {
    // UK's national address is named "Address to the Nation".
    const embed = buildNationalAddressEmbed({
      countryId: "UK",
      title: "A New Dawn for Britain",
      body: "My fellow citizens, today we begin a new chapter.",
      deliveredByName: "PM Jane Smith",
    });

    expect(embed.title).toBe("Address to the Nation: A New Dawn for Britain");
    expect(embed.color).toBe(DISCORD_COLORS.nationalAddress);
  });

  it("includes the deliverer, the country, and the full speech body in the description", () => {
    const embed = buildNationalAddressEmbed({
      countryId: "UK",
      title: "A New Dawn",
      body: "My fellow citizens, today we begin a new chapter.",
      deliveredByName: "PM Jane Smith",
    });

    expect(embed.description).toContain("PM Jane Smith");
    expect(embed.description).toContain("United Kingdom");
    expect(embed.description).toContain("My fellow citizens, today we begin a new chapter.");
  });

  it("omits the speech body cleanly when none is provided", () => {
    const embed = buildNationalAddressEmbed({
      countryId: "US",
      title: "State of the Union",
      deliveredByName: "President Doe",
    });

    // US national address name is "State of the Union".
    expect(embed.title).toBe("State of the Union: State of the Union");
    expect(embed.description).toContain("President Doe");
    expect(embed.description).not.toContain("\n\n");
  });

  it("truncates an over-long body to keep the embed within Discord's limit", () => {
    const longBody = "x".repeat(5000);
    const embed = buildNationalAddressEmbed({
      countryId: "UK",
      title: "Long Speech",
      body: longBody,
      deliveredByName: "PM Jane Smith",
    });

    expect(embed.description!.length).toBeLessThanOrEqual(4096);
  });
});
