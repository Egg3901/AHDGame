import { describe, it, expect } from "vitest";
import { calculateActionPriorities, type NppActionContext } from "./actionAi";
import { careerArchetypeModifiers } from "@/lib/nppAutonomy/v3/careerArchetype";

const baseContext: NppActionContext = {
  hasOffice: true,
  personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
  funds: 1_000_000,
  actionPoints: 100,
  donorBaseLevel: 0,
};

describe("actionAi v3 archetype weighting", () => {
  it("without modifiers, priorities are unchanged from the pre-v3 base", () => {
    const p = calculateActionPriorities(baseContext);
    // hasOffice base, ambition/loyalty == 50 → no personality nudges
    expect(p).toEqual({ campaign: 40, advertise: 30, buildDonorBase: 20, partyDonation: 10 });
  });

  it("a reformer scales campaign/advertise up and buildDonorBase by its fundraise appetite", () => {
    const reformer = careerArchetypeModifiers({ loyalty: 50, ambition: 80, stubbornness: 20 });
    const p = calculateActionPriorities(baseContext, reformer);
    expect(p.campaign).toBe(Math.round(40 * reformer.campaignAggressionMult));
    expect(p.advertise).toBe(Math.round(30 * reformer.campaignAggressionMult));
    expect(p.buildDonorBase).toBe(Math.round(20 * reformer.fundraiseAppetiteMult));
    // partyDonation stays loyalty-driven (untouched by the modifiers)
    expect(p.partyDonation).toBe(10);
  });

  it("a technocrat (high fundraise appetite) prioritizes donor-building more than a reformer", () => {
    const technocrat = careerArchetypeModifiers({ loyalty: 50, ambition: 20, stubbornness: 20 });
    const reformer = careerArchetypeModifiers({ loyalty: 50, ambition: 80, stubbornness: 20 });
    const techDonor = calculateActionPriorities(baseContext, technocrat).buildDonorBase;
    const reformerDonor = calculateActionPriorities(baseContext, reformer).buildDonorBase;
    expect(techDonor).toBeGreaterThan(reformerDonor);
  });
});
