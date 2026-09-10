import { describe, expect, it } from "vitest";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { ERA_CONFIGS } from "@/components/landing/eraThemes";
import {
  GAME_VERSION,
  REGISTERED_COUNTRY_COUNT,
  countWord,
  eraRoster,
  fallbackMarketedWorld,
  formatNationChoices,
  formatNationList,
  nationKeywords,
  resolveEraCopy,
  toEraId,
} from "./marketedWorld";
import pkg from "../../../package.json";

describe("marketedWorld", () => {
  it("reports the released version, not a copy of it", () => {
    expect(GAME_VERSION).toBe(pkg.version);
    expect(GAME_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("counts registered countries from COUNTRY_ORDER", () => {
    expect(REGISTERED_COUNTRY_COUNT).toBe(COUNTRY_ORDER.length);
  });

  it("falls back to a known era when the seed year has no landing config", () => {
    expect(toEraId(1953)).toBe("1953");
    expect(toEraId(1861)).toBe("1979");
  });

  it("derives the era roster from the landing configs", () => {
    const roster = eraRoster("1953");
    expect(roster.player).toEqual(["US", "UK", "RU", "DD"]);
    expect(roster.econ).toContain("DE");
    expect(roster.econ).not.toContain("US");
  });

  it("names countries for the era, not for the present day", () => {
    const world = fallbackMarketedWorld(1953);
    const names = world.playable.map((n) => n.name);
    expect(names).toContain("Soviet Union");
    expect(names).not.toContain("Russia");
    expect(world.economy.map((n) => n.name)).toContain("West Germany");
  });

  it("orders the playable list by COUNTRY_ORDER so every surface reads alike", () => {
    const world = fallbackMarketedWorld(1953);
    const ids = world.playable.map((n) => n.id);
    const expected = COUNTRY_ORDER.filter((id) => ids.includes(id));
    expect(ids).toEqual(expected);
  });

  describe("formatNationList", () => {
    const n = (name: string) => ({ id: "US" as const, name });

    it("returns an empty string for no nations", () => {
      expect(formatNationList([])).toBe("");
    });

    it("joins two with the conjunction and no comma", () => {
      expect(formatNationList([n("A"), n("B")])).toBe("A and B");
    });

    it("uses an Oxford comma for three or more", () => {
      expect(formatNationList([n("A"), n("B"), n("C")])).toBe("A, B, and C");
    });

    it("offers choices with or", () => {
      expect(formatNationChoices([n("A"), n("B"), n("C")])).toBe("A, B, or C");
    });
  });

  it("builds SEO keywords from the live roster", () => {
    const world = fallbackMarketedWorld(1953);
    expect(nationKeywords(world.playable)).toContain("Soviet Union politics");
    expect(nationKeywords(world.playable)).not.toContain("Japan politics");
  });

  describe("countWord", () => {
    it("spells small counts, which is how the prose reads", () => {
      expect(countWord(4)).toBe("four");
      expect(countWord(0)).toBe("zero");
    });

    it("falls back to digits past the word list", () => {
      expect(countWord(37)).toBe("37");
    });
  });

  it("fills the {playableCount} slot in era prose, sentence-capitalised", () => {
    const world = fallbackMarketedWorld(1953);
    const resolved = resolveEraCopy(ERA_CONFIGS["1953"].worldSectionDek, world);
    expect(resolved).not.toContain("{playableCount}");
    expect(resolved).toContain("Four are open to players");
  });

  it("resolves every era's world dek without leaving a placeholder", () => {
    const world = fallbackMarketedWorld(1953);
    for (const [eraId, config] of Object.entries(ERA_CONFIGS)) {
      const resolved = resolveEraCopy(config.worldSectionDek, world);
      expect(resolved, `era ${eraId}`).not.toContain("{");
    }
  });
});
