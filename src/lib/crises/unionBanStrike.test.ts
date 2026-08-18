import { describe, expect, it } from "vitest";
import { ALL_CRISIS_TEMPLATES, UNION_BAN_GENERAL_STRIKE_TEMPLATE } from "./templates";
import {
  UNION_BAN_STRIKE_DURATION_TURNS,
  UNION_BAN_STRIKE_NODES,
  UNION_BAN_STRIKE_TEMPLATE_KEY,
  UNION_BAN_STRUCK_SECTORS,
  struckTradesFor,
} from "./unionBanStrikeCopy";
import {
  NEGOTIATE_MAX_CHANCE,
  NEGOTIATE_MIN_CHANCE,
  RIDE_OUT_EFFECT_RETENTION,
  UNION_BAN_EXECUTIVE_COSTS,
  UNION_BAN_SEGMENTS,
  diminishEffects,
  negotiateSuccessChance,
  segmentsFor,
} from "./unionBanStrike";
import { strikeStartHeadlines } from "./unionBanStrikeWire";

describe("union ban strike template", () => {
  const template = UNION_BAN_GENERAL_STRIKE_TEMPLATE;
  const tree = template.interactionDefinition?.decisionTree ?? [];
  const nodeIds = new Set(tree.map((n) => n.nodeId));

  it("is registered under its shared key", () => {
    expect(ALL_CRISIS_TEMPLATES[UNION_BAN_STRIKE_TEMPLATE_KEY]).toBe(template);
  });

  it("is country scoped with no preset countries, so the trigger names the country", () => {
    expect(template.scope).toBe("country");
    expect(template.countryIds).toEqual([]);
  });

  it("runs 24 turns", () => {
    expect(template.durationTurns).toBe(UNION_BAN_STRIKE_DURATION_TURNS);
    expect(UNION_BAN_STRIKE_DURATION_TURNS).toBe(24);
  });

  it("hits every struck sector with a physical shock", () => {
    for (const sector of UNION_BAN_STRUCK_SECTORS) {
      const shock = template.effects.find((e) => e.sectorType === sector && e.value < 0);
      expect(shock, `no shock for ${sector}`).toBeTruthy();
    }
  });

  it("every option target and every hook redirect resolves to a real node", () => {
    for (const node of tree) {
      for (const option of node.options ?? []) {
        if (option.nextNodeId) {
          expect(nodeIds.has(option.nextNodeId), `missing ${option.nextNodeId}`).toBe(true);
        }
      }
    }
    for (const nodeId of Object.values(UNION_BAN_STRIKE_NODES)) {
      expect(nodeIds.has(nodeId), `missing ${nodeId}`).toBe(true);
    }
  });

  it("negotiate loops back to its own node so talks can be retried", () => {
    const response = tree.find((n) => n.nodeId === UNION_BAN_STRIKE_NODES.response);
    const negotiate = response?.options?.find((o) => o.optionId === "response_negotiate");
    expect(negotiate?.nextNodeId).toBe(UNION_BAN_STRIKE_NODES.response);
  });

  it("all four responses carry the action hook", () => {
    const response = tree.find((n) => n.nodeId === UNION_BAN_STRIKE_NODES.response);
    const responses = (response?.options ?? []).map(
      (o) => o.action?.kind === "unionBanStrikeResponse" && o.action.response
    );
    expect(responses.sort()).toEqual(["army", "backDown", "negotiate", "rideOut"].sort());
  });

  it("never auto-resolves on the executive's behalf", () => {
    expect(template.interactionDefinition?.autoResolveOnExpiry).toBe(false);
    const response = tree.find((n) => n.nodeId === UNION_BAN_STRIKE_NODES.response);
    expect(response?.timeLimitMinutes).toBeNull();
  });
});

describe("negotiateSuccessChance", () => {
  it("is bounded at both ends", () => {
    expect(negotiateSuccessChance(0)).toBe(NEGOTIATE_MIN_CHANCE);
    expect(negotiateSuccessChance(100)).toBe(NEGOTIATE_MAX_CHANCE);
    expect(negotiateSuccessChance(-50)).toBe(NEGOTIATE_MIN_CHANCE);
    expect(negotiateSuccessChance(1000)).toBe(NEGOTIATE_MAX_CHANCE);
  });

  it("rises with labour approval and defaults on bad input", () => {
    expect(negotiateSuccessChance(80)).toBeGreaterThan(negotiateSuccessChance(20));
    expect(negotiateSuccessChance(Number.NaN)).toBe(negotiateSuccessChance(50));
  });
});

describe("diminishEffects", () => {
  it("scales every effect and keeps everything else", () => {
    const effects = UNION_BAN_GENERAL_STRIKE_TEMPLATE.effects.map((e, i) => ({
      ...e,
      effectId: `e${i}`,
    }));
    const halved = diminishEffects(effects, RIDE_OUT_EFFECT_RETENTION);
    expect(halved).toHaveLength(effects.length);
    halved.forEach((effect, i) => {
      expect(effect.value).toBeCloseTo(effects[i].value * RIDE_OUT_EFFECT_RETENTION);
      expect(effect.description).toBe(effects[i].description);
    });
  });
});

describe("segments and costs", () => {
  it("falls back to default segments for unconfigured countries", () => {
    expect(segmentsFor("FR")).toBe(UNION_BAN_SEGMENTS.default);
    expect(segmentsFor("US")).toBe(UNION_BAN_SEGMENTS.US);
  });

  it("prices the army as the harshest labour cost and back-down as the business cost", () => {
    const costs = UNION_BAN_EXECUTIVE_COSTS;
    expect(costs.army.labourSegment).toBeGreaterThan(costs.rideOut.labourSegment);
    expect(costs.army.businessSegment).toBe(0);
    expect(costs.backDown.businessSegment).toBeGreaterThan(0);
    expect(costs.backDown.labourSegment).toBe(0);
  });
});

describe("copy quality", () => {
  it("player copy carries no em or en dashes and no stock AI phrasing", () => {
    const tree = UNION_BAN_GENERAL_STRIKE_TEMPLATE.interactionDefinition?.decisionTree ?? [];
    const copy: string[] = [
      UNION_BAN_GENERAL_STRIKE_TEMPLATE.description,
      UNION_BAN_GENERAL_STRIKE_TEMPLATE.wireMessageOnStart ?? "",
      UNION_BAN_GENERAL_STRIKE_TEMPLATE.wireMessageOnEnd ?? "",
      ...tree.flatMap((n) => [
        n.title,
        n.description,
        n.outcomeMessage ?? "",
        ...(n.options ?? []).flatMap((o) => [o.label, o.description]),
      ]),
    ];
    for (const country of ["US", "UK", "DE", "FR"]) {
      const headlines = strikeStartHeadlines(country);
      copy.push(
        headlines.global.title,
        headlines.global.body,
        headlines.national.title,
        headlines.national.body,
        struckTradesFor(country)
      );
    }
    expect(copy.filter((line) => /[–—]/.test(line))).toEqual([]);
    expect(copy.filter((line) => /delve|it's not just|dive in/i.test(line))).toEqual([]);
  });
});
