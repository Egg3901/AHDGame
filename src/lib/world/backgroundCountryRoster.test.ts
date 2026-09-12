import { describe, expect, it } from "vitest";
import { getWorldEntityPresetManifest } from "./worldEntityManifest";

const PRESETS = [
  "1953-default",
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
  "2023-default",
] as const;

describe("background country expansion", () => {
  it("gives every active sovereign a simulation tier", () => {
    for (const preset of PRESETS) {
      const manifest = getWorldEntityPresetManifest(preset);
      const sovereigns = manifest.entries.filter((entry) => entry.status === "sovereign");
      expect(sovereigns.length, preset).toBeGreaterThan(90);
      expect(
        sovereigns.every((entry) => entry.simulationTier !== "historical-presence"),
        preset
      ).toBe(true);
      expect(new Set(sovereigns.map((entry) => entry.entityId)).size, preset).toBe(
        sovereigns.length
      );
    }
  });

  it("uses era-correct unifications and dissolutions", () => {
    const p1979 = getWorldEntityPresetManifest("1979-default").entries;
    expect(p1979.find((entry) => entry.entityId === "VN")?.status).toBe("sovereign");
    expect(p1979.find((entry) => entry.entityId === "NVN")).toBeUndefined();

    const p1991 = getWorldEntityPresetManifest("1991-default").entries;
    expect(p1991.find((entry) => entry.entityId === "YU")?.status).toBe("sovereign");
    expect(p1991.find((entry) => entry.entityId === "CS")?.status).toBe("sovereign");

    const p1999 = getWorldEntityPresetManifest("1999-default").entries;
    expect(p1999.find((entry) => entry.entityId === "YU")?.status).toBe("dissolved");
    expect(p1999.find((entry) => entry.entityId === "CS")?.status).toBe("dissolved");
    expect(p1999.find((entry) => entry.entityId === "CZ2")?.status).toBe("sovereign");
    expect(p1999.find((entry) => entry.entityId === "SK")?.status).toBe("sovereign");
  });

  it("never promotes dependencies into background simulation before independence", () => {
    const p1953 = getWorldEntityPresetManifest("1953-default").entries;
    expect(p1953.find((entry) => entry.entityId === "BC")).toMatchObject({
      status: "dependent",
      simulationTier: "historical-presence",
    });
    expect(p1953.find((entry) => entry.entityId === "GH")).toMatchObject({ status: "emergent" });
  });
});
