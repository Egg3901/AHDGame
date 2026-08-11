import { describe, expect, it } from "vitest";
import { MARKET_MODE_INFO, MARKET_MODE_ORDER } from "./modes";
import { gameConfig as referenceGameConfig } from "@/lib/seeds/reference/gameConfig";

/**
 * The launch state of the tier ladder, asserted against the REAL module.
 *
 * `route.test.ts` mocks `MARKET_MODE_INFO` to keep the non-live refusal branch
 * covered once every tier went live; that mock means it can no longer observe
 * the true flag. This file is the other half: it pins the actual shipped state,
 * so a tier cannot be un-launched or launched by accident without a test
 * saying so out loud.
 */
describe("MARKET_MODE_INFO — launch state", () => {
  it("plants is live and therefore selectable in the admin panel", () => {
    expect(MARKET_MODE_INFO.plants.live).toBe(true);
  });

  it("every tier in the order has metadata", () => {
    for (const mode of MARKET_MODE_ORDER) {
      expect(MARKET_MODE_INFO[mode]).toBeDefined();
      expect(MARKET_MODE_INFO[mode].label.length).toBeGreaterThan(0);
    }
  });

  it("plants is the top of the ladder", () => {
    expect(MARKET_MODE_ORDER[MARKET_MODE_ORDER.length - 1]).toBe("plants");
  });
});

/**
 * A fresh world boots at the TOP of the ladder (owner rule, 2026-08-08: every
 * gate defaults on / at max except ops and the sector auto-seed).
 *
 * The preflight/soak/rollback ceremony that once held this default a rung low
 * guards *migrating a live legacy economy* into plants — a fresh world has no
 * legacy revenue to rebase, so none of it applies. Holding it low instead left
 * the top tier inert in every world nobody hand-flipped, which is the failure
 * this pins against. Changing a running world's tier is still an operator act
 * through the admin route; only the seed default lives here.
 */
describe("reference gameConfig — fresh-world default", () => {
  it("a fresh world boots at the top of the ladder", () => {
    expect(referenceGameConfig.marketSystemMode).toBe(
      MARKET_MODE_ORDER[MARKET_MODE_ORDER.length - 1]
    );
  });
});
