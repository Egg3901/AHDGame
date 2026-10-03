import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERA_FLAVOR_CARDS, FLAVOR_CARD_PORTRAITS } from "./flavorCards";

describe("FLAVOR_CARD_PORTRAITS", () => {
  it("lists only portraits that ship with the repo", () => {
    for (const slug of FLAVOR_CARD_PORTRAITS) {
      const file = path.join(process.cwd(), "public/static/flavor-cards", `${slug}.webp`);
      expect(existsSync(file), slug).toBe(true);
    }
  });

  it("covers every portrait the repo ships that a card uses", () => {
    const used = new Set(
      Object.values(ERA_FLAVOR_CARDS).flatMap((cards) => cards.map((c) => c.imageSlug))
    );
    for (const slug of used) {
      const file = path.join(process.cwd(), "public/static/flavor-cards", `${slug}.webp`);
      if (existsSync(file)) expect(FLAVOR_CARD_PORTRAITS.has(slug), slug).toBe(true);
    }
  });
});
