/** Regional pressure is calibrated gameplay, not a prediction of historical winners. */
export const ARAB_UPRISINGS_KEY = "arab_uprisings";
export const ARAB_ORIGINS = ["TN", "EG", "LY", "SY", "YE"] as const;
export type ArabOriginId = (typeof ARAB_ORIGINS)[number];
export type ArabTrajectory =
  "pressure" | "protest" | "reform" | "transition" | "authoritarian" | "civil_war" | "frozen";

export interface ArabOriginSignal {
  countryId: string;
  population: number;
  /** Measured approval for a playable government, aggregate stability otherwise. */
  legitimacy: number;
  unemployment?: number;
  /** Ratio of food demand to supply; missing observations remain neutral. */
  foodStress: number;
  /** Explicit provenance prevents estimated background capacity becoming a measured job rate. */
  basis: "playable" | "background";
}
export interface ArabOriginState {
  /** Dated seed evidence; subsequent player/NPC choices can change the trajectory. */
  openingSourceUrl?: string;
  openingEvidenceAsOf?: string;
  policy: "unchanged" | "reform" | "repress" | "transition";
  population: number;
  legitimacy: number;
  mobilization: number;
  repression: number;
  cohesion: number;
  opposition: number;
  outsideSupport: number;
  sanctions: number;
  civilianStrain: number;
  displacement: number;
  infrastructureDamage: number;
  settlement: number;
  reconstruction: number;
  extremistSpace: number;
  trajectory: ArabTrajectory;
  signalBasis: ArabOriginSignal["basis"];
  npcPolicyReceipt?: {
    turn: number;
    policy: "reform" | "repress" | "transition";
    legitimacy: number;
    cohesion: number;
  };
}
export interface ArabRegionalState {
  origins: Partial<Record<ArabOriginId, ArabOriginState>>;
  hosts: Record<string, { population: number; protection: number; refugeePeople: number }>;
  lastPressureTurn?: number;
  resolutionIds: string[];
}
export const boundedArab = (value: number, max = 100) =>
  Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
export function initialArabOrigin(signal: ArabOriginSignal): ArabOriginState {
  return {
    policy: "unchanged",
    population: Math.max(0, signal.population),
    legitimacy: boundedArab(signal.legitimacy),
    mobilization: 20,
    repression: 35,
    cohesion: boundedArab(40 + signal.legitimacy * 0.4),
    opposition: 0,
    outsideSupport: 0,
    sanctions: 0,
    civilianStrain: 10,
    displacement: 0,
    infrastructureDamage: 0,
    settlement: 0,
    reconstruction: 0,
    extremistSpace: 5,
    trajectory: "pressure",
    signalBasis: signal.basis,
  };
}
export function classifyArabOrigin(origin: ArabOriginState): ArabTrajectory {
  if (["civil_war", "frozen"].includes(origin.trajectory)) {
    if (origin.settlement >= 60 && origin.opposition <= 65) return "frozen";
    return "civil_war";
  }
  // Armed conflict needs repression, fragmentation AND an actual outside commitment.
  if (
    origin.repression >= 55 &&
    origin.cohesion <= 55 &&
    origin.opposition >= 30 &&
    origin.outsideSupport > 0
  )
    return "civil_war";
  if (origin.policy === "transition" && origin.settlement >= 54 && origin.repression <= 50)
    return "transition";
  if (
    origin.policy === "reform" &&
    origin.legitimacy >= 58 &&
    origin.mobilization <= 35 &&
    origin.repression <= 40
  )
    return "reform";
  if (origin.repression >= 60 && origin.cohesion >= 45 && origin.opposition < 30)
    return "authoritarian";
  return origin.mobilization >= 40 ? "protest" : "pressure";
}

export function pressureOnArabOrigin(
  previous: ArabOriginState,
  signal: ArabOriginSignal,
  regionalMobilization: number
): ArabOriginState {
  const next = {
    ...previous,
    population: Math.max(0, signal.population),
    signalBasis: signal.basis,
  };
  const jobs = signal.unemployment === undefined ? 0 : Math.max(0, signal.unemployment - 6) * 0.25;
  const food = Math.max(0, Math.min(3, signal.foodStress) - 1) * 4;
  const legitimacy = Math.max(0, 55 - signal.legitimacy) / 10;
  // Diffusion is stronger where domestic grievances already exist, not a cloned outcome.
  const diffusion = regionalMobilization >= 45 ? Math.min(3, (jobs + food + legitimacy) / 2) : 0;
  const grievance = jobs + food + legitimacy + diffusion;
  next.mobilization = boundedArab(
    next.mobilization + grievance - (next.trajectory === "reform" ? 5 : 1)
  );
  next.legitimacy = boundedArab(next.legitimacy + (signal.legitimacy - next.legitimacy) * 0.08);
  if (next.repression >= 55 && next.mobilization >= 35) {
    next.cohesion = boundedArab(next.cohesion - 2);
    next.opposition = boundedArab(next.opposition + 3);
    next.extremistSpace = boundedArab(next.extremistSpace + 1);
  }
  if (next.trajectory === "civil_war") {
    next.civilianStrain = boundedArab(next.civilianStrain + 3);
    next.displacement = boundedArab(next.displacement + 4);
    next.infrastructureDamage = boundedArab(next.infrastructureDamage + 2);
    next.extremistSpace = boundedArab(next.extremistSpace + 2);
  } else if (["frozen", "transition", "reform"].includes(next.trajectory)) {
    next.reconstruction = boundedArab(next.reconstruction + 3);
    next.displacement = boundedArab(next.displacement - 2);
    next.civilianStrain = boundedArab(next.civilianStrain - 2);
    next.infrastructureDamage = boundedArab(next.infrastructureDamage - 1);
    next.extremistSpace = boundedArab(next.extremistSpace - 1);
  }
  next.outsideSupport = boundedArab(next.outsideSupport - 1);
  next.sanctions = boundedArab(next.sanctions - 2);
  next.trajectory = classifyArabOrigin(next);
  return next;
}

/** Only an accepted, authorized government response changes its own policy. */
export function applyArabGovernmentChoice(
  previous: ArabOriginState,
  option: string
): ArabOriginState {
  const next = { ...previous };
  if (["reform", "repress", "transition"].includes(option))
    next.policy = option as ArabOriginState["policy"];
  const change = (
    key: keyof Pick<
      ArabOriginState,
      "legitimacy" | "mobilization" | "repression" | "cohesion" | "settlement" | "opposition"
    >,
    delta: number
  ) => {
    next[key] = boundedArab(next[key] + delta);
  };
  if (option === "reform") {
    change("legitimacy", 12);
    change("mobilization", -12);
    change("repression", -6);
    change("cohesion", 2);
  } else if (option === "transition") {
    change("legitimacy", 6);
    change("mobilization", -6);
    change("repression", -4);
    change("settlement", 18);
    change("opposition", -5);
  } else if (option === "repress") {
    change("repression", 14);
    change("legitimacy", -8);
    change("mobilization", -8);
    change("cohesion", -5);
  }
  next.trajectory = classifyArabOrigin(next);
  return next;
}

/** Non-playable sovereign authorities have an explicit simulated policy.
 * This is not a player response, election, treaty or legislative consent. */
export function applyArabNpcPolicy(
  origin: ArabOriginState,
  signal: ArabOriginSignal,
  turn: number
): ArabOriginState {
  if (
    signal.basis !== "background" ||
    origin.npcPolicyReceipt?.turn === turn ||
    turn % 24 !== 0 ||
    origin.mobilization < 40
  )
    return origin;
  const policy =
    origin.legitimacy >= 55 ? "reform" : origin.cohesion >= 45 ? "repress" : "transition";
  const next = applyArabGovernmentChoice(origin, policy);
  return {
    ...next,
    npcPolicyReceipt: { turn, policy, legitimacy: origin.legitimacy, cohesion: origin.cohesion },
  };
}
