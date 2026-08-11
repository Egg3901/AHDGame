import { describe, it, expect } from "vitest";
import {
  ChallengerBudget,
  NPP_ATTACK_PLAYER_DEFENDER_COOLDOWN_TURNS,
  NPP_CHALLENGERS_PER_COUNTRY_PER_PASS,
  NPP_FLOAT_RESERVE_FRACTION,
  NPP_PLAYER_NOTIFICATIONS_PER_WINDOW,
  NPP_SPONSOR_ACTIVE_CAP_PLAYER_COUNTRY,
  NPP_SPONSOR_COOLDOWN_TURNS_PLAYER_COUNTRY,
  canAttackDefender,
  canNotifyPlayer,
  nppSponsorLimitsForCountry,
  politeFloatLimit,
} from "../playerImpactBudget";
import { NPP_SPONSOR_ACTIVE_CAP, NPP_SPONSOR_COOLDOWN_TURNS } from "../constants";
import type { CountryId } from "@/lib/constants/countries";

const US = "US" as CountryId;
const UK = "UK" as CountryId;

describe("playerImpactBudget", () => {
  describe("sponsorship limits", () => {
    it("leaves non-player countries on the established constants", () => {
      expect(nppSponsorLimitsForCountry(false)).toEqual({
        activeCap: NPP_SPONSOR_ACTIVE_CAP,
        cooldownTurns: NPP_SPONSOR_COOLDOWN_TURNS,
      });
    });

    it("is strictly tighter in a player country than in an NPP-only one", () => {
      const player = nppSponsorLimitsForCountry(true);
      const npc = nppSponsorLimitsForCountry(false);
      expect(player.activeCap).toBeLessThan(npc.activeCap);
      expect(player.cooldownTurns).toBeGreaterThan(npc.cooldownTurns);
      expect(player.activeCap).toBe(NPP_SPONSOR_ACTIVE_CAP_PLAYER_COUNTRY);
      expect(player.cooldownTurns).toBe(NPP_SPONSOR_COOLDOWN_TURNS_PLAYER_COUNTRY);
    });
  });

  describe("ChallengerBudget", () => {
    it("caps challengers per country", () => {
      const budget = new ChallengerBudget();
      let allowed = 0;
      for (let i = 0; i < 20; i++) {
        if (budget.canChallenge(US)) {
          budget.record(US);
          allowed++;
        }
      }
      expect(allowed).toBe(NPP_CHALLENGERS_PER_COUNTRY_PER_PASS);
    });

    it("budgets each country independently", () => {
      const budget = new ChallengerBudget();
      for (let i = 0; i < NPP_CHALLENGERS_PER_COUNTRY_PER_PASS; i++) {
        budget.record(US);
      }
      expect(budget.canChallenge(US)).toBe(false);
      expect(budget.canChallenge(UK)).toBe(true);
    });

    it("challenges a given player candidate at most once", () => {
      const budget = new ChallengerBudget(99);
      expect(budget.canChallenge(US, "race-1:party-a")).toBe(true);
      budget.record(US, "race-1:party-a");
      expect(budget.canChallenge(US, "race-1:party-a")).toBe(false);
      // A different player race is still fair game.
      expect(budget.canChallenge(US, "race-2:party-a")).toBe(true);
    });
  });

  describe("defender attack cooldown", () => {
    it("never throttles NPP-owned defenders", () => {
      expect(
        canAttackDefender({
          defenderIsPlayerOwned: false,
          lastPlayerAttackedTurn: 100,
          currentTurn: 101,
        })
      ).toBe(true);
    });

    it("blocks a repeat strike on a player defender inside the window", () => {
      expect(
        canAttackDefender({
          defenderIsPlayerOwned: true,
          lastPlayerAttackedTurn: 100,
          currentTurn: 100 + NPP_ATTACK_PLAYER_DEFENDER_COOLDOWN_TURNS - 1,
        })
      ).toBe(false);
    });

    it("allows the strike once the window has elapsed", () => {
      expect(
        canAttackDefender({
          defenderIsPlayerOwned: true,
          lastPlayerAttackedTurn: 100,
          currentTurn: 100 + NPP_ATTACK_PLAYER_DEFENDER_COOLDOWN_TURNS,
        })
      ).toBe(true);
    });

    it("allows a first-ever strike", () => {
      expect(
        canAttackDefender({
          defenderIsPlayerOwned: true,
          lastPlayerAttackedTurn: undefined,
          currentTurn: 5,
        })
      ).toBe(true);
    });
  });

  describe("politeFloatLimit", () => {
    it("always leaves the reserve fraction untouched", () => {
      for (const float of [100, 1_000, 987_654]) {
        const limit = politeFloatLimit(float);
        expect(limit).toBeLessThanOrEqual(float * (1 - NPP_FLOAT_RESERVE_FRACTION));
        expect(float - limit).toBeGreaterThan(0);
      }
    });

    it("handles degenerate floats without going negative", () => {
      expect(politeFloatLimit(0)).toBe(0);
      expect(politeFloatLimit(-5)).toBe(0);
      expect(politeFloatLimit(Number.NaN)).toBe(0);
      expect(politeFloatLimit(1)).toBe(0);
    });
  });

  describe("notification budget", () => {
    it("stops once the window allowance is spent", () => {
      expect(canNotifyPlayer(0)).toBe(true);
      expect(canNotifyPlayer(NPP_PLAYER_NOTIFICATIONS_PER_WINDOW - 1)).toBe(true);
      expect(canNotifyPlayer(NPP_PLAYER_NOTIFICATIONS_PER_WINDOW)).toBe(false);
      expect(canNotifyPlayer(NPP_PLAYER_NOTIFICATIONS_PER_WINDOW + 10)).toBe(false);
    });
  });
});
