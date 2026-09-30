/**
 * Containment buys time; funded research, production and access build protection.
 * Infection still harms people while governments cooperate. Immunity wanes and
 * periodic immune escape can renew an emergency after restrictions are lifted.
 */
import type { GlobalResponseOutcome, CrisisInteraction } from "@/lib/db/types/crisis";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import type { LivingConflictState } from "../types";

export const PANDEMIC_KEY = "pandemic";
type Signal = Pick<
  LivingConflictState,
  "hasOpened" | "status" | "tracks" | "totalTurns" | "phaseLevel" | "pandemicOriginCountryId"
>;
const bounded = (value: number, max = 100) =>
  Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
const read = (state: Signal, key: string) => bounded(state.tracks?.[key] ?? 0);
export function pandemicVaccineReady(state: Signal): boolean {
  return (
    state.totalTurns >= 48 &&
    read(state, "vaccineResearch") >= 70 &&
    read(state, "manufacturing") >= 35
  );
}

/** Annual excess death fraction, separate from ordinary cohort mortality. */
export function pandemicMortality(state: Signal | null | undefined, countryId?: string): number {
  if (!state?.hasOpened || state.status === "closed") return 0;
  const exposure =
    !countryId ||
    !state.pandemicOriginCountryId ||
    countryId === state.pandemicOriginCountryId ||
    state.phaseLevel >= 3
      ? 1
      : state.phaseLevel === 1
        ? 0.1
        : 0.4;
  const transmission = read(state, "transmission") / 100;
  const access =
    countryId && pandemicVaccineReady(state)
      ? 1 +
        (1 - read(state, "distributionEquity") / 100) *
          (0.2 - read(state, `vaccinePriority:${countryId}`) * 0.005)
      : 1;
  return Math.min(
    0.012,
    0.006 *
      exposure *
      access *
      transmission ** 2 *
      (1 - read(state, "immunity") / 110) *
      (2 - read(state, "healthCapacity") / 100)
  );
}

/** Standing offsets recover with the outbreak instead of compounding each turn. */
export function pandemicPoliticalEffects(
  state: Signal | null | undefined,
  countryId?: string
): Partial<Record<PoliticalMetricId, number>> {
  if (!state?.hasOpened || state.status === "closed") return {};
  return {
    "health.outcomes": -Math.min(12, pandemicMortality(state, countryId) * 1400),
    "health.systemEfficiency":
      (-read(state, "transmission") * (100 - read(state, "healthCapacity"))) / 1500,
    "economy.productivity": -read(state, "supplyChainStrain") * 0.06,
    "economy.workerSecurity": -read(state, "supplyChainStrain") * 0.04,
    "order.communityTrust": -read(state, "restrictionFatigue") * 0.04,
  };
}

/** One turn, called by the conflict driver's existing turn receipt. */
export function advancePandemicState(state: LivingConflictState): LivingConflictState {
  if (!state.hasOpened || state.status === "closed") return state;
  const t = { ...state.tracks };
  const get = (key: string) => read(state, key);
  const set = (key: string, value: number) => {
    t[key] = bounded(value);
  };
  const variant = state.totalTurns > 0 && state.totalTurns % 96 === 0;
  const transmission = get("transmission");
  const immunity = get("immunity");
  const containment = get("containmentPolicy");
  const capacity = get("healthCapacity");
  const vaccineReady = pandemicVaccineReady(state);
  const growth =
    (1.6 -
      containment * 0.032 -
      get("travelControls") * 0.006 -
      get("surveillance") * 0.009 -
      immunity * 0.023 -
      capacity * 0.003) *
    (0.35 + transmission / 100);
  set("transmission", Math.max(1, transmission + growth + (variant ? 22 : 0)));
  set(
    "healthCapacity",
    capacity +
      0.16 +
      get("capacityInvestment") * 0.005 -
      Math.max(0, transmission - 40) * 0.012 * (1 - immunity / 120)
  );
  set("surveillance", get("surveillance") - 0.025);
  set(
    "vaccineResearch",
    get("vaccineResearch") + get("researchInvestment") * 0.035 * (1 + get("cooperation") / 200)
  );
  set("manufacturing", get("manufacturing") + get("manufacturingInvestment") * 0.025);
  const rollout = vaccineReady
    ? (get("manufacturing") *
        0.035 *
        (0.2 + get("distributionEquity") / 100) *
        get("distributionInvestment")) /
      100
    : 0;
  set(
    "immunity",
    immunity + transmission * 0.012 * (1 - immunity / 100) + rollout - 0.12 - (variant ? 22 : 0)
  );
  set("restrictionFatigue", get("restrictionFatigue") + containment * 0.007 - 0.18);
  set(
    "publicTrust",
    get("publicTrust") +
      get("cooperation") * 0.002 -
      Math.max(0, get("restrictionFatigue") - 45) * 0.004 -
      transmission * 0.001
  );
  const strainTarget = bounded(
    containment * 0.5 + transmission * 0.35 - get("economicSupport") * 0.25
  );
  set(
    "supplyChainStrain",
    get("supplyChainStrain") + (strainTarget - get("supplyChainStrain")) * 0.06
  );
  if (variant) set("variantWaves", get("variantWaves") + 1);
  // Campaign normalization rounds displayed consequences to tenths. Preserve
  // the full accumulated toll in a track so small weekly losses are not erased.
  const accumulated =
    state.tracks?.cumulativeMortalityIndex ?? state.campaign?.consequences.casualties ?? 0;
  set("cumulativeMortalityIndex", accumulated + pandemicMortality(state) * 18);
  const campaign = state.campaign
    ? {
        ...state.campaign,
        consequences: {
          ...state.campaign.consequences,
          casualties: t.cumulativeMortalityIndex,
          civilianStrain: bounded(strainTarget),
        },
      }
    : state.campaign;
  return { ...state, tracks: t, campaign, intensity: t.transmission };
}

/** Combine every funded policy rather than discarding all but one winning axis. */
export function pandemicResponseOutcome(
  state: LivingConflictState,
  scores: Record<string, number>,
  eligibleCountries: number,
  template: GlobalResponseOutcome,
  responses: NonNullable<CrisisInteraction["leaderResponses"]> = []
): GlobalResponseOutcome {
  const level = (key: string) =>
    bounded(((scores[key] ?? 0) * 25) / Math.max(1, eligibleCountries));
  const target: Record<string, number> = {
    containmentPolicy: level("containment"),
    travelControls: level("travel"),
    researchInvestment: level("research"),
    manufacturingInvestment: level("manufacturing"),
    capacityInvestment: level("capacity"),
    cooperation: level("cooperation"),
    economicSupport: level("support"),
    distributionInvestment: bounded(level("equity") + level("nationalism")),
  };
  const trackDeltas: Record<string, number> = Object.fromEntries(
    Object.entries(target).map(([key, value]) => [key, value - read(state, key)])
  );
  trackDeltas.surveillance = level("surveillance") * 0.3;
  trackDeltas.healthCapacity = level("capacity") * 0.08;
  trackDeltas.distributionEquity = level("equity") * 0.2 - level("nationalism") * 0.18;
  trackDeltas.publicTrust = level("cooperation") * 0.025 - level("nationalism") * 0.03;
  for (const response of responses) {
    const key = `vaccinePriority:${response.countryId}`;
    trackDeltas[key] = bounded((response.responseScores?.nationalism ?? 0) * 25) - read(state, key);
  }
  // National production can advance supply, but cannot skip clinical development.
  trackDeltas.manufacturing = level("nationalism") * 0.025;
  return {
    ...template,
    label: "Pandemic response commitments",
    description:
      "Funded containment, research and supply policies will shape the next response interval.",
    wireMessage:
      "Governments commit their next pandemic policies; disease and clinical development continue over time.",
    trackDeltas,
    campaignDelta: undefined,
    intensityDelta: undefined,
    nextConflictStatus: undefined,
    nextCampaignStage: undefined,
    tensionDelta: undefined,
    effectsByRole: undefined,
  };
}

/** A stable world-specific origin; stored outbreaks retain their recorded origin. */
export function pandemicParticipants(
  available: ReadonlySet<string>,
  year: number,
  recordedOrigin?: string
): import("../types").LivingConflictDef["participants"] {
  const countries = [...available].sort();
  const origin =
    recordedOrigin && available.has(recordedOrigin)
      ? recordedOrigin
      : countries[Math.abs(Math.trunc(year) * 17) % Math.max(1, countries.length)];
  return {
    belligerents: origin ? [origin] : [],
    neighbors: [],
    blocMembers: [],
    bystanders: countries.filter((id) => id !== origin),
  };
}

/** Emergence lies in a modern risk window, with timing contingent on the world. */
export function pandemicOpeningYear(participants: {
  belligerents: string[];
  bystanders?: string[];
}): number {
  const key = [...participants.belligerents, ...(participants.bystanders ?? [])].sort().join("");
  const seed = [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return 2018 + (seed % 3);
}
