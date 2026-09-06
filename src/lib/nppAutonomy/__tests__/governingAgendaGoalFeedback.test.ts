import { describe, it, expect } from "vitest";
import { computeGoverningAgenda, type GoverningAgendaInputs } from "../governingAgenda";
import type { NPPPersonality } from "@/lib/db/types/npp";

const technocrat: NPPPersonality = { ambition: 20, stubbornness: 20, loyalty: 50 };

function base(overrides: Partial<GoverningAgendaInputs> = {}): GoverningAgendaInputs {
  return {
    conditions: { weakDomains: { healthcare: 0.9, education: 0.8 } },
    ideology: { economic: 0, social: 0 },
    personality: technocrat,
    currentTurn: 100,
    ...overrides,
  };
}

describe("computeGoverningAgenda — V5 goal feedback", () => {
  it("is byte-identical when no feedback is supplied (every level below v5)", () => {
    expect(computeGoverningAgenda(base({ goalFeedback: undefined }))).toEqual(
      computeGoverningAgenda(base())
    );
    expect(computeGoverningAgenda(base({ goalFeedback: {} }))).toEqual(
      computeGoverningAgenda(base())
    );
  });

  it("demotes a domain the government keeps failing", () => {
    const before = computeGoverningAgenda(base());
    expect(before.items[0].domain).toBe("healthcare");

    const after = computeGoverningAgenda(base({ goalFeedback: { healthcare: 0.5 } }));
    // Education overtakes it: same conditions, different record.
    expect(after.items[0].domain).toBe("education");
    expect(after.items.map((i) => i.domain)).toContain("healthcare");
  });

  it("never invents a domain the drivers did not already produce", () => {
    const agenda = computeGoverningAgenda(base({ goalFeedback: { defense: 1.5 } }));
    expect(agenda.items.map((i) => i.domain)).not.toContain("defense");
  });

  it("never changes a domain's direction", () => {
    const before = computeGoverningAgenda(
      base({ conditions: { weakDomains: {}, strongDomains: { healthcare: 0.9 } } })
    );
    const after = computeGoverningAgenda(
      base({
        conditions: { weakDomains: {}, strongDomains: { healthcare: 0.9 } },
        goalFeedback: { healthcare: 0.5 },
      })
    );
    expect(before.items[0].direction).toBe("lower");
    expect(after.items[0].direction).toBe("lower");
  });

  /**
   * The ordering contract: an emergency is added AFTER feedback, so a domain the
   * government has failed five times running still gets answered when it catches
   * fire.
   */
  it("does not damp crisis mass", () => {
    const withCrisis = computeGoverningAgenda(
      base({ crises: { healthcare: 1 }, goalFeedback: { healthcare: 0.5 } })
    );
    expect(withCrisis.items[0].domain).toBe("healthcare");
    expect(withCrisis.items[0].crisis).toBe(true);
  });

  it("clamps a nonsensical multiplier instead of scaling by it", () => {
    const huge = computeGoverningAgenda(base({ goalFeedback: { healthcare: 1_000 } }));
    const ceiling = computeGoverningAgenda(base({ goalFeedback: { healthcare: 1.5 } }));
    expect(huge.items).toEqual(ceiling.items);

    const tiny = computeGoverningAgenda(base({ goalFeedback: { healthcare: 0.000_1 } }));
    const floor = computeGoverningAgenda(base({ goalFeedback: { healthcare: 0.5 } }));
    expect(tiny.items).toEqual(floor.items);
  });

  it("ignores a non-positive multiplier rather than zeroing a domain", () => {
    const zeroed = computeGoverningAgenda(base({ goalFeedback: { healthcare: 0 } }));
    expect(zeroed.items).toEqual(computeGoverningAgenda(base()).items);
  });
});
