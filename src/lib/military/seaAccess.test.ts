import { describe, it, expect } from "vitest";
import { deriveSeaAccess } from "./seaAccess";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

const hosts = (...ids: string[]) => ids as WorldEntityId[];

describe("deriveSeaAccess", () => {
  it("gives a coastal host sea access", () => {
    // East Germany held the Volksmarine on the Baltic.
    expect(deriveSeaAccess(hosts("DD"), "Plain / forest")).toBe(true);
  });

  it("denies it to a landlocked host", () => {
    // Czechoslovakia has ground and air branches only.
    expect(deriveSeaAccess(hosts("CS"), "Plain / forest")).toBe(false);
    expect(deriveSeaAccess(hosts("BLR"), "Plain / forest")).toBe(false);
  });

  it("grants access when ANY host entity is coastal", () => {
    // A war fought over two countries reaches the sea if either does.
    expect(deriveSeaAccess(hosts("CS", "DD"), "Plain / forest")).toBe(true);
  });

  it("ignores era gating, because coastline is not force structure", () => {
    // Yugoslavia's navy carries dissolvedYear 1992; its coast did not dissolve.
    expect(deriveSeaAccess(hosts("YU"), "Plain / forest")).toBe(true);
  });

  it("falls back to terrain for a faction host with no branch table", () => {
    // Proxy-war belligerents are factions with no COUNTRY_CONFIGS row.
    expect(deriveSeaAccess(hosts("NVN"), "Jungle / delta")).toBe(true);
    expect(deriveSeaAccess(hosts("NVN"), "Plain / forest")).toBe(false);
    expect(deriveSeaAccess(hosts("NVN"), "Open ocean")).toBe(true);
  });

  it("prefers a real country over the terrain fallback", () => {
    // A landlocked country on jungle ground is still landlocked.
    expect(deriveSeaAccess(hosts("CS"), "Jungle / delta")).toBe(false);
  });

  it("denies access for an empty host list rather than throwing", () => {
    expect(deriveSeaAccess(hosts(), "Plain / forest")).toBe(false);
  });

  it("matches the branch table regardless of the id's case", () => {
    // A lowercase id that missed the table would fall through to the terrain guess and
    // silently hand a landlocked country a coastline.
    expect(deriveSeaAccess(hosts("dd"), "Plain / forest")).toBe(true);
    expect(deriveSeaAccess(hosts("cs"), "Jungle / delta")).toBe(false);
  });
});
