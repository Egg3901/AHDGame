import { describe, expect, it } from "vitest";
import { resolveCountryAvailability } from "./countryAvailability";

describe("resolveCountryAvailability()", () => {
  it("marks active enabled countries as playable", () => {
    expect(
      resolveCountryAvailability("US", {
        enabledForPlayers: true,
        status: "active",
        economyPreview: false,
      })
    ).toMatchObject({
      accessMode: "full",
      displayState: "playable",
      tone: "active",
      label: "Active",
      isClickable: true,
      preferredPath: "/country/us",
    });
  });

  it("marks enabled beta countries as beta access", () => {
    expect(
      resolveCountryAvailability("UK", {
        enabledForPlayers: true,
        status: "beta",
        economyPreview: false,
      })
    ).toMatchObject({
      accessMode: "full",
      displayState: "beta-access",
      tone: "beta",
      label: "Beta Access",
      isClickable: true,
      preferredPath: "/country/uk",
    });
  });

  it("marks a disabled economy-preview country as econ-only, pointed at the overview", () => {
    expect(
      resolveCountryAvailability("JP", {
        enabledForPlayers: false,
        status: "beta",
        economyPreview: true,
      })
    ).toMatchObject({
      accessMode: "econ-only",
      displayState: "econ-only",
      tone: "planned",
      label: "Econ-Only",
      isClickable: true,
      // The overview, not /map — every page under it renders now.
      preferredPath: "/country/jp",
    });
  });

  it("marks a coming-soon country as econ-only, not planned-and-dead", () => {
    // The Eastern bloc case: registered, seeded, and browsable read-only even
    // though it is nowhere near playable.
    expect(
      resolveCountryAvailability("PL", {
        enabledForPlayers: false,
        status: "coming-soon",
        economyPreview: false,
      })
    ).toMatchObject({
      accessMode: "econ-only",
      displayState: "econ-only",
      label: "Econ-Only",
      isClickable: true,
      preferredPath: "/country/pl",
    });
  });

  it("marks a disabled active country as econ-only", () => {
    expect(
      resolveCountryAvailability("DE", {
        enabledForPlayers: false,
        status: "active",
        economyPreview: false,
      })
    ).toMatchObject({
      accessMode: "econ-only",
      displayState: "econ-only",
      isClickable: true,
      preferredPath: "/country/de",
    });
  });

  it("treats an omitted `registered` flag as registered", () => {
    // Most call sites carry only the three legacy fields.
    expect(
      resolveCountryAvailability("IE", {
        enabledForPlayers: false,
        status: "coming-soon",
        economyPreview: false,
      }).accessMode
    ).toBe("econ-only");
  });

  it("keeps an unregistered latent country hidden", () => {
    // SCO/WAL before a secession activates them: no seeded world to show, so
    // opening the tier on them would render blank pages.
    expect(
      resolveCountryAvailability("SCO", {
        enabledForPlayers: false,
        status: "coming-soon",
        economyPreview: false,
        registered: false,
      })
    ).toMatchObject({
      accessMode: "hidden",
      displayState: "hidden",
      label: "Under Development",
      isClickable: false,
      preferredPath: null,
    });
  });

  it("sorts playable nations ahead of econ-only ones", () => {
    const playable = resolveCountryAvailability("US", {
      enabledForPlayers: true,
      status: "active",
      economyPreview: false,
    });
    const econOnly = resolveCountryAvailability("PL", {
      enabledForPlayers: false,
      status: "coming-soon",
      economyPreview: false,
    });
    expect(playable.sortOrder).toBeLessThan(econOnly.sortOrder);
  });
});
