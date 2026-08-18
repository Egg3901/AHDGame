import { describe, it, expect, afterEach } from "vitest";
import { ALL_CRISIS_TEMPLATES, ANTIWAR_PROTEST_TEMPLATE } from "./templates";
import {
  getVietnamEscalationLevel,
  normalizeVietnamLevel,
  setVietnamEscalationLevel,
} from "./vietnamEscalationInterface";
import { chainTemplateKeyForLevel, familyTemplates, CHAIN_LEVEL_RESOLVERS } from "./crisisChain";
import { isTemplateAllowedInYear } from "./crisisEraWindow";
import { isMultiResponderNode } from "./interactionEngine";
import {
  VIETNAM_FROM_YEAR,
  VIETNAM_MAX_LEVEL,
  VIETNAM_RUNGS,
  VIETNAM_UNTIL_YEAR,
  vietnamTemplateKeyForLevel,
} from "./vietnamEscalation";
import type { CrisisTemplate } from "@/lib/db/types/crisis";

const vietnam = Object.entries(ALL_CRISIS_TEMPLATES as Record<string, CrisisTemplate>).filter(
  ([, t]) => t.chain?.family === "vietnam"
);

describe("Vietnam crisis chain", () => {
  describe("template family", () => {
    it("registers one template per rung", () => {
      expect(vietnam.length).toBe(VIETNAM_RUNGS.length);
      const rungs = vietnam.map(([, t]) => t.chain!.rung).sort((a, b) => a - b);
      expect(rungs).toEqual(VIETNAM_RUNGS.map((r) => r.level));
    });

    it("keys every template exactly as the ladder expects", () => {
      for (const rung of VIETNAM_RUNGS) {
        const key = vietnamTemplateKeyForLevel(rung.level)!;
        expect(ALL_CRISIS_TEMPLATES[key], `missing template ${key}`).toBeDefined();
        expect((ALL_CRISIS_TEMPLATES[key] as CrisisTemplate).chain!.rung).toBe(rung.level);
      }
    });

    it("addresses every rung to both superpowers", () => {
      for (const [key, t] of vietnam) {
        expect(t.scope, key).toBe("country");
        expect([...t.countryIds].sort(), key).toEqual(["RU", "US"]);
      }
    });

    it("gives every rung a decision both leaders can answer", () => {
      for (const [key, t] of vietnam) {
        const tree = t.interactionDefinition?.decisionTree ?? [];
        expect(tree.length, key).toBe(1);
        const node = tree[0];
        expect(node.type, key).toBe("choice");
        expect(node.requiredRoles, key).toContain("headOfState");
        expect(isMultiResponderNode(t, node), key).toBe(true);
        const optionIds = (node.options ?? []).map((o) => o.optionId);
        expect(optionIds, key).toEqual(["vietnam_support", "vietnam_hold", "vietnam_deescalate"]);
      }
    });

    it("wires the support and de-escalate options to real subsystem actions", () => {
      for (const [key, t] of vietnam) {
        const options = t.interactionDefinition!.decisionTree[0].options!;
        expect(options.find((o) => o.optionId === "vietnam_support")!.action, key).toEqual({
          kind: "vietnamSupport",
        });
        expect(options.find((o) => o.optionId === "vietnam_deescalate")!.action, key).toEqual({
          kind: "vietnamDeescalate",
        });
      }
    });

    it("makes the war heavier at every rung", () => {
      const drag = (t: CrisisTemplate) =>
        t.effects.filter((e) => e.targetType === "approval").reduce((s, e) => s + e.value, 0);
      const ordered = [...vietnam].sort((a, b) => a[1].chain!.rung - b[1].chain!.rung);
      for (let i = 1; i < ordered.length; i++) {
        expect(drag(ordered[i][1])).toBeLessThan(drag(ordered[i - 1][1]));
      }
    });
  });

  describe("era gating", () => {
    it("opens the window at the first year and closes it after the last", () => {
      for (const [key, t] of vietnam) {
        expect(t.fromYear, key).toBe(VIETNAM_FROM_YEAR);
        expect(t.untilYear, key).toBe(VIETNAM_UNTIL_YEAR);
        expect(isTemplateAllowedInYear(t, VIETNAM_FROM_YEAR - 1), key).toBe(false);
        expect(isTemplateAllowedInYear(t, VIETNAM_FROM_YEAR), key).toBe(true);
        expect(isTemplateAllowedInYear(t, 1968), key).toBe(true);
        expect(isTemplateAllowedInYear(t, VIETNAM_UNTIL_YEAR), key).toBe(true);
        expect(isTemplateAllowedInYear(t, VIETNAM_UNTIL_YEAR + 1), key).toBe(false);
      }
    });
  });

  describe("chain resolution", () => {
    it("registers a level resolver for the family", () => {
      expect(CHAIN_LEVEL_RESOLVERS.vietnam).toBeTypeOf("function");
    });

    it("indexes the family by rung", () => {
      const byRung = familyTemplates("vietnam");
      expect(byRung.size).toBe(VIETNAM_RUNGS.length);
      expect(byRung.get(1)![0]).toBe("vietnam_advisors");
      expect(byRung.get(6)![0]).toBe("vietnam_full_war");
    });

    it("follows the ladder's current level rather than a fixed sequence", () => {
      for (const rung of VIETNAM_RUNGS) {
        expect(chainTemplateKeyForLevel("vietnam", rung.level)).toBe(
          vietnamTemplateKeyForLevel(rung.level)
        );
      }
    });

    it("stops the chain when the ladder is talked down to nothing", () => {
      expect(chainTemplateKeyForLevel("vietnam", 0)).toBeNull();
      expect(chainTemplateKeyForLevel("vietnam", -1)).toBeNull();
    });

    it("returns nothing for an unknown family", () => {
      expect(chainTemplateKeyForLevel("korea", 2)).toBeNull();
      expect(familyTemplates("korea").size).toBe(0);
    });
  });

  /**
   * The seam between this track and the 1960s protest family. Their anti-war
   * template scales its spawn weight and its approval bite off
   * `getVietnamEscalationLevel()`, which used to be hardcoded to 0. It now reads
   * the real ladder, so these assertions are what stop that wiring from being
   * silently reverted to a constant.
   */
  describe("anti-war protests scale with the ladder", () => {
    afterEach(() => setVietnamEscalationLevel(0));

    const spawnChance = () => {
      const trig = ANTIWAR_PROTEST_TEMPLATE.autoTrigger;
      if (trig?.kind !== "random") throw new Error("anti-war template lost its random trigger");
      return trig.spawnChance;
    };
    const approvalBite = () =>
      ANTIWAR_PROTEST_TEMPLATE.effects.find((e) => e.targetType === "approval")!.value;

    it("normalizes the ladder onto the 0-1 dial", () => {
      expect(normalizeVietnamLevel(0)).toBe(0);
      expect(normalizeVietnamLevel(VIETNAM_MAX_LEVEL)).toBe(1);
      expect(normalizeVietnamLevel(VIETNAM_MAX_LEVEL / 2)).toBeCloseTo(0.5);
      expect(normalizeVietnamLevel(-3)).toBe(0);
      expect(normalizeVietnamLevel(999)).toBe(1);
    });

    it("sits at the documented floor with no war", () => {
      setVietnamEscalationLevel(0);
      expect(spawnChance()).toBeCloseTo(0.0015);
    });

    it("raises the spawn weight once the ladder is off the ground", () => {
      setVietnamEscalationLevel(0);
      const floor = spawnChance();
      setVietnamEscalationLevel(normalizeVietnamLevel(4));
      const escalated = spawnChance();
      expect(escalated).toBeGreaterThan(floor);
      setVietnamEscalationLevel(1);
      expect(spawnChance()).toBeGreaterThan(escalated);
      expect(spawnChance()).toBeCloseTo(0.004);
    });

    it("raises the spawn weight monotonically up the ladder", () => {
      let previous = -1;
      for (let level = 0; level <= VIETNAM_MAX_LEVEL; level++) {
        setVietnamEscalationLevel(normalizeVietnamLevel(level));
        const chance = spawnChance();
        expect(chance).toBeGreaterThan(previous);
        previous = chance;
      }
    });

    it("makes the protests bite harder the deeper the war goes", () => {
      setVietnamEscalationLevel(0);
      const floor = approvalBite();
      setVietnamEscalationLevel(1);
      expect(approvalBite()).toBeLessThan(floor);
    });

    it("reads through the interface rather than a load-time constant", () => {
      setVietnamEscalationLevel(0);
      expect(getVietnamEscalationLevel()).toBe(0);
      setVietnamEscalationLevel(normalizeVietnamLevel(VIETNAM_MAX_LEVEL));
      expect(getVietnamEscalationLevel()).toBe(1);
      expect(spawnChance()).toBeCloseTo(0.004);
    });
  });

  describe("single-country crises are untouched by the multi-responder change", () => {
    it("keeps an ordinary country crisis single-responder", () => {
      const node = vietnam[0][1].interactionDefinition!.decisionTree[0];
      expect(isMultiResponderNode({ scope: "country", countryIds: ["US"] }, node)).toBe(false);
      expect(isMultiResponderNode({ scope: "country", countryIds: [] }, node)).toBe(false);
      expect(isMultiResponderNode({ scope: "global", countryIds: [] }, node)).toBe(true);
    });
  });
});
