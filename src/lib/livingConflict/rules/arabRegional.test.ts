import { describe, expect, it } from "vitest";
import { emptyConflictState } from "../engine";
import { ARAB_UPRISINGS_DEF } from "../defs/arabUprisings";
import { resolveConflictParticipants } from "./participants";
import {
  advanceArabRegion,
  allocateArabRefugees,
  arabEconomicTarget,
  resolveArabRegion,
} from "./arabRegional";
import {
  initialArabOrigin,
  applyArabNpcPolicy,
  pressureOnArabOrigin,
  type ArabOriginSignal,
} from "./arabOrigins";
import { projectArabRegion } from "./arabProjection";
import { assessCampaignRequirement } from "../campaign";

const signal = (countryId = "SY", legitimacy = 35): ArabOriginSignal => ({
  countryId,
  legitimacy,
  population: 20_000_000,
  foodStress: 1,
  unemployment: 12,
  basis: "playable",
});
const region = () =>
  advanceArabRegion(
    undefined,
    [signal("TN"), signal("SY"), signal("EG", 65)],
    { TR: 80_000_000, JO: 10_000_000, DE: 80_000_000 },
    1
  );

describe("independent Arab regional trajectories", () => {
  it("keeps absent Syria represented without assigning its authority to Turkey", () => {
    const participants = resolveConflictParticipants(
      ARAB_UPRISINGS_DEF,
      new Set(["TR", "JO", "US", "RU"])
    );
    expect(participants.belligerents).not.toContain("TR");
    expect(participants.neighbors).toContain("TR");
    expect(
      participants.representedActors?.find((actor) => actor.representsCountryId === "SY")?.countryId
    ).toBeUndefined();
  });
  it("measures pressure locally and diffuses grievances without identical outcomes", () => {
    const high = pressureOnArabOrigin(
      initialArabOrigin(signal()),
      { ...signal(), foodStress: 2, unemployment: 25 },
      65
    );
    const low = pressureOnArabOrigin(
      initialArabOrigin(signal("EG", 80)),
      { ...signal("EG", 80), unemployment: 3 },
      65
    );
    expect(high.mobilization).toBeGreaterThan(low.mobilization + 8);
    expect(low.trajectory).toBe("pressure");
  });
  it("does not manufacture consent or aid when all authorities are absent", () => {
    const initial = region();
    const after = resolveArabRegion(initial, [], "absent");
    expect(after.origins).toEqual(initial.origins);
    expect(Object.values(after.hosts).every((host) => host.protection === 0)).toBe(true);
    expect(resolveArabRegion(after, [], "absent")).toBe(after);
  });
  it("reform belongs only to the consenting government", () => {
    let state = region();
    for (let i = 0; i < 3; i++)
      state = resolveArabRegion(state, [{ countryId: "TN", optionId: "reform" }], `reform${i}`);
    expect(state.origins.TN?.trajectory).toBe("reform");
    expect(state.origins.SY?.policy).toBe("unchanged");
    expect(state.origins.EG?.trajectory).toBe("pressure");
  });
  it("a cohesive crackdown can restore authoritarian control without civil war", () => {
    let state = region();
    for (let i = 0; i < 3; i++)
      state = resolveArabRegion(state, [{ countryId: "EG", optionId: "repress" }], `crackdown${i}`);
    expect(state.origins.EG?.trajectory).toBe("authoritarian");
    expect(state.origins.EG?.displacement).toBe(0);
  });
  it("negotiated domestic transition requires repeated actual agreement", () => {
    let state = region();
    for (let i = 0; i < 3; i++)
      state = resolveArabRegion(
        state,
        [
          { countryId: "TN", optionId: "transition" },
          { countryId: "US", optionId: "mediate_west" },
        ],
        `talk${i}`
      );
    expect(state.origins.TN?.trajectory).toBe("transition");
    expect(state.origins.SY?.trajectory).toBe("pressure");
  });
  it("civil war needs repression, fragmentation and accepted outside backing", () => {
    let state = region();
    for (let i = 0; i < 3; i++)
      state = resolveArabRegion(state, [{ countryId: "SY", optionId: "repress" }], `repress${i}`);
    expect(state.origins.SY?.trajectory).not.toBe("civil_war");
    for (let i = 0; i < 3; i++)
      state = resolveArabRegion(
        state,
        [{ countryId: "TR", optionId: "arm_opposition" }],
        `proxy${i}`
      );
    expect(state.origins.SY?.trajectory).toBe("civil_war");
    expect(state.origins.TN?.trajectory).toBe("pressure");
    state = advanceArabRegion(state, [signal("SY")], {}, 12);
    expect(state.origins.SY?.displacement).toBeGreaterThan(0);
    const totalHosts = Object.values(state.hosts).reduce(
      (sum, host) => sum + host.refugeePeople,
      0
    );
    expect(totalHosts).toBeCloseTo(((20_000_000 * state.origins.SY!.displacement) / 1000) * 0.5);
    const conflict = {
      ...emptyConflictState("arab_uprisings"),
      hasOpened: true,
      arabRegional: state,
    };
    expect(arabEconomicTarget(conflict, "SY").displacedShare).toBeGreaterThan(0);
    expect(arabEconomicTarget(conflict, "TR").hostingShare).toBeGreaterThan(0);
    expect(arabEconomicTarget(conflict, "US").hostingShare).toBe(0);
    for (let i = 0; i < 4; i++)
      state = resolveArabRegion(
        state,
        ["US", "RU", "IN"].map((countryId) => ({ countryId, optionId: "un_talks" })),
        `peace${i}`
      );
    expect(state.origins.SY?.trajectory).toBe("frozen");
    const displacedBefore = state.origins.SY!.displacement;
    state = advanceArabRegion(state, [signal("SY")], {}, 24);
    expect(state.origins.SY!.displacement).toBeLessThan(displacedBefore);
    expect(state.origins.SY!.reconstruction).toBeGreaterThan(0);
    expect(projectArabRegion({ ...conflict, arabRegional: state }).campaign?.stage).toBe("posture");
  });
  it("uses real capacity gates and durable military/humanitarian commitments", () => {
    const trees = ARAB_UPRISINGS_DEF.phases[0].events[0].response!.decisionTrees;
    const protect = trees.backer_a!.options!.find((option) => option.optionId === "protect")!;
    expect(protect.campaignCommitment?.kind).toBe("military");
    expect(
      assessCampaignRequirement(
        protect.campaignRequirement,
        {
          militaryReadiness: 20,
          logistics: 20,
          domesticSupport: 50,
          intelligence: 30,
          treasuryPctGdp: 1,
          assessedAt: new Date(0),
        },
        "posture"
      ).eligible
    ).toBe(false);
    expect(
      trees.neighbor!.options!.find((option) => option.optionId === "host_refugees")
        ?.campaignCommitment?.kind
    ).toBe("humanitarian");
  });
  it("records differing autonomous background policies without impersonating a player", () => {
    const background = { ...signal(), basis: "background" as const };
    const base = { ...initialArabOrigin(background), mobilization: 60 };
    expect(applyArabNpcPolicy({ ...base, legitimacy: 65 }, background, 24).policy).toBe("reform");
    expect(
      applyArabNpcPolicy({ ...base, legitimacy: 25, cohesion: 70 }, background, 24).policy
    ).toBe("repress");
    expect(
      applyArabNpcPolicy({ ...base, legitimacy: 25, cohesion: 35 }, background, 24).policy
    ).toBe("transition");
    const first = applyArabNpcPolicy(base, background, 24);
    expect(first.npcPolicyReceipt?.turn).toBe(24);
    expect(applyArabNpcPolicy(first, background, 24)).toBe(first);
    expect(applyArabNpcPolicy(base, signal(), 24)).toBe(base);
  });
  it("retry neither repeats quarterly pressure nor duplicates refugee allocations", () => {
    const state = region();
    expect(advanceArabRegion(state, [signal()], {}, 1)).toBe(state);
    expect(allocateArabRefugees(allocateArabRefugees(state))).toEqual(allocateArabRefugees(state));
  });
});
