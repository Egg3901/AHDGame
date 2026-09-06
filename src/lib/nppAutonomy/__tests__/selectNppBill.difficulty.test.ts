/**
 * The two difficulty levers and the V5 goal bias on bill selection. Everything
 * here is a DECISION difference: the sponsor's cap, cooldown, costs and the set
 * of laws it may file are untouched at every difficulty.
 */
import { describe, it, expect } from "vitest";
import type { LegislationType, LegislationPolicyOption, NPP } from "@/lib/db/types";
import type { GoverningAgendaItem } from "../governingAgenda";
import { selectNppBill, type ConditionsSignal } from "../selectNppBill";
import { nppBehaviorPolicy } from "@/lib/singleplayerDifficulty/rules/behavior";

function option(over: Partial<LegislationPolicyOption> & { id: string }): LegislationPolicyOption {
  return {
    name: over.id,
    stance: "center",
    effectDirection: 1,
    economic: 0,
    social: 0,
    ...over,
  } as LegislationPolicyOption;
}

function legType(id: string, policyDomain: string, economic: number): LegislationType {
  return {
    _id: id,
    name: `Bill ${id}`,
    description: "",
    policyDomain,
    subCategory: "",
    positions: [],
    policyOptions: [option({ id: `${id}_1`, economic })],
  } as unknown as LegislationType;
}

const npp = { policies: { economic: 5, social: 0 } } as NPP;
const noUrgency: ConditionsSignal = { weakDomains: {} };
const easy = nppBehaviorPolicy("easy");
const normal = nppBehaviorPolicy("normal");
const hard = nppBehaviorPolicy("hard");

describe("selectNppBill — difficulty candidate breadth", () => {
  // 20 candidates, only one of which is a perfect ideological match.
  const filler = Array.from({ length: 20 }, (_, index) =>
    legType(`filler_${index}`, "education", -1)
  );
  const perfect = legType("perfect", "education", 5);
  const candidates = [...filler, perfect];

  it("normal reads every candidate and finds the best one", () => {
    const selection = selectNppBill(
      candidates,
      npp,
      noUrgency,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        policy: normal,
        slateSalt: "US:5:100",
      }
    );
    expect(selection?.legType._id).toBe("perfect");
  });

  it("easy reads a narrower slate, so it can miss the best one", () => {
    // Across many decisions an easy sponsor picks the best bill only sometimes;
    // a normal sponsor picks it every time.
    const easyPicks = Array.from({ length: 30 }, (_, turn) =>
      selectNppBill(candidates, npp, noUrgency, undefined, undefined, undefined, undefined, {
        policy: easy,
        slateSalt: `US:5:${turn}`,
      })
    ).map((selection) => selection?.legType._id);
    const hits = easyPicks.filter((id) => id === "perfect").length;
    expect(hits).toBeGreaterThan(0); // the slate rotates, so it is reachable
    expect(hits).toBeLessThan(easyPicks.length); // but not every time
  });

  it("a narrowed slate still only ever files a real candidate", () => {
    const ids = new Set(candidates.map((c) => c._id));
    for (let turn = 0; turn < 20; turn++) {
      const selection = selectNppBill(
        candidates,
        npp,
        noUrgency,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          policy: easy,
          slateSalt: `US:5:${turn}`,
        }
      );
      expect(ids.has(selection!.legType._id)).toBe(true);
    }
  });

  it("is deterministic: the same decision replays to the same bill", () => {
    const args = [
      candidates,
      npp,
      noUrgency,
      undefined,
      undefined,
      undefined,
      undefined,
      { policy: easy, slateSalt: "US:5:7" },
    ] as const;
    expect(selectNppBill(...args)?.legType._id).toBe(selectNppBill(...args)?.legType._id);
  });
});

describe("selectNppBill — difficulty decline threshold", () => {
  // A single weak candidate: platform fit is poor and nothing is urgent.
  const weak = [legType("weak", "education", -5)];

  it("easy and normal file the weak bill", () => {
    for (const policy of [easy, normal]) {
      const selection = selectNppBill(
        weak,
        npp,
        noUrgency,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          policy,
        }
      );
      expect(selection).not.toBeNull();
      expect(selection!.score).toBeLessThan(hard.minBillScore);
    }
  });

  it("hard declines it and keeps the slot", () => {
    expect(
      selectNppBill(weak, npp, noUrgency, undefined, undefined, undefined, undefined, {
        policy: hard,
      })
    ).toBeNull();
  });

  it("hard still files a bill worth filing", () => {
    const strong = [legType("strong", "education", 5)];
    const selection = selectNppBill(
      strong,
      npp,
      noUrgency,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        policy: hard,
      }
    );
    expect(selection?.legType._id).toBe("strong");
  });
});

describe("selectNppBill — V5 goal bias", () => {
  const agenda: GoverningAgendaItem[] = [
    { domain: "healthcare", target: 65, direction: "raise", priority: 0.55 },
    { domain: "education", target: 65, direction: "raise", priority: 0.5 },
  ];
  // Two equally-fitting bills; only the agenda priorities separate them.
  const healthcare = legType("h", "healthcare", 5);
  const education = legType("e", "education", 5);

  it("without goals, the agenda alone decides", () => {
    const selection = selectNppBill([healthcare, education], npp, noUrgency, agenda);
    expect(selection?.legType._id).toBe("h");
  });

  it("a standing goal tilts a close call toward the committed domain", () => {
    const selection = selectNppBill(
      [healthcare, education],
      npp,
      noUrgency,
      agenda,
      undefined,
      undefined,
      undefined,
      { goalDomains: new Set(["education"]), policy: normal }
    );
    expect(selection?.legType._id).toBe("e");
  });

  it("an empty goal set changes nothing", () => {
    const withEmpty = selectNppBill(
      [healthcare, education],
      npp,
      noUrgency,
      agenda,
      undefined,
      undefined,
      undefined,
      { goalDomains: new Set<string>(), policy: normal }
    );
    expect(withEmpty?.legType._id).toBe("h");
  });

  it("does not let a goal manufacture a bill outside the agenda", () => {
    // "defense" is committed but no candidate serves it; selection is unchanged.
    const selection = selectNppBill(
      [healthcare, education],
      npp,
      noUrgency,
      agenda,
      undefined,
      undefined,
      undefined,
      { goalDomains: new Set(["defense"]), policy: normal }
    );
    expect(selection?.legType._id).toBe("h");
  });
});
