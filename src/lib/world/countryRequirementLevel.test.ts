import { describe, expect, it } from "vitest";
import {
  COUNTRY_REQUIREMENT_PROFILES,
  countryBackgroundModeForEraTier,
  countryRequirementLevelForAccess,
  countryRequirementLevelForEraTier,
} from "./countryRequirementLevel";

describe("country requirement levels", () => {
  it("classifies runtime access with player access taking precedence", () => {
    expect(
      countryRequirementLevelForAccess({ enabledForPlayers: true, economyPreview: true })
    ).toBe("player-enabled");
    expect(
      countryRequirementLevelForAccess({ enabledForPlayers: false, economyPreview: true })
    ).toBe("economy-preview");
    expect(
      countryRequirementLevelForAccess({ enabledForPlayers: false, economyPreview: false })
    ).toBe("background");
  });

  it("maps every era tier to one of the three completeness contracts", () => {
    expect(countryRequirementLevelForEraTier("player")).toBe("player-enabled");
    expect(countryRequirementLevelForEraTier("econ")).toBe("economy-preview");
    for (const tier of ["npp", "latent", "absent"] as const) {
      expect(countryRequirementLevelForEraTier(tier)).toBe("background");
    }
  });

  it("preserves the runtime mode of a background country", () => {
    expect(countryBackgroundModeForEraTier("npp")).toBe("npp");
    expect(countryBackgroundModeForEraTier("latent")).toBe("latent");
    expect(countryBackgroundModeForEraTier("absent")).toBe("absent");
    expect(countryBackgroundModeForEraTier("econ")).toBeNull();
    expect(countryBackgroundModeForEraTier("player")).toBeNull();
  });

  it("raises requirements monotonically from background to player-enabled", () => {
    expect(COUNTRY_REQUIREMENT_PROFILES.background.readinessTarget).toBeNull();
    expect(COUNTRY_REQUIREMENT_PROFILES["economy-preview"].readinessTarget).toBe("autonomous");
    expect(COUNTRY_REQUIREMENT_PROFILES["player-enabled"].readinessTarget).toBe("player");

    expect(COUNTRY_REQUIREMENT_PROFILES.background.requires).toMatchObject({
      folderContract: true,
      completeEraCoverage: true,
      autonomousReadiness: false,
      playerReadiness: false,
    });
    expect(COUNTRY_REQUIREMENT_PROFILES["economy-preview"].requires).toMatchObject({
      autonomousReadiness: true,
      playerReadiness: false,
    });
    expect(COUNTRY_REQUIREMENT_PROFILES["player-enabled"].requires).toMatchObject({
      autonomousReadiness: true,
      playerReadiness: true,
    });
  });
});
