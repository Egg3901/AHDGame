import { describe, it, expect } from "vitest";
import { buildBillVetoedDiscordEmbed, DISCORD_COLORS } from "./discordWebhooks";

describe("buildBillVetoedDiscordEmbed", () => {
  const billUrl = "https://ahousedividedgame.com/congress/bills/abc123";

  it("names the bill and the vetoing president in the description", () => {
    const embed = buildBillVetoedDiscordEmbed({
      billTitle: "Clean Air Act",
      presidentName: "Jane Doe",
      billUrl,
    });

    expect(embed.title).toBe("USA — Bill Vetoed — Federal");
    expect(embed.description).toContain("Clean Air Act");
    expect(embed.description).toContain("President Jane Doe");
    expect(embed.color).toBe(DISCORD_COLORS.billVetoed);
    expect(embed.url).toBe(billUrl);
  });

  it("falls back to 'the President' when no name is supplied", () => {
    const embed = buildBillVetoedDiscordEmbed({
      billTitle: "Budget Bill",
      billUrl,
    });

    expect(embed.description).toContain("the President");
    expect(embed.description).not.toContain("President undefined");
  });

  it("includes a View Bill link field pointing at the bill", () => {
    const embed = buildBillVetoedDiscordEmbed({ billTitle: "Tax Bill", billUrl });

    const viewField = embed.fields?.find((f) => f.name === "View Bill");
    expect(viewField).toBeDefined();
    expect(viewField?.value).toContain(billUrl);
  });

  it("adds a Veto Message field only when a message is provided", () => {
    const withMsg = buildBillVetoedDiscordEmbed({
      billTitle: "Tax Bill",
      billUrl,
      vetoMessage: "This bill is fiscally irresponsible.",
    });
    const withoutMsg = buildBillVetoedDiscordEmbed({ billTitle: "Tax Bill", billUrl });

    const msgField = withMsg.fields?.find((f) => f.name === "Veto Message");
    expect(msgField?.value).toBe("This bill is fiscally irresponsible.");
    expect(withoutMsg.fields?.some((f) => f.name === "Veto Message")).toBe(false);
  });
});
