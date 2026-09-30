import type { LivingConflictState } from "../types";
import { ARAB_UPRISINGS_KEY, boundedArab, type ArabRegionalState } from "./arabOrigins";

/** The visible regional phase summarizes independent origins; it never writes
 * a winning regional narrative back over their individual political outcomes. */
export function projectArabRegion(state: LivingConflictState): LivingConflictState {
  if (state.defKey !== ARAB_UPRISINGS_KEY || !state.arabRegional) return state;
  const origins = Object.values(state.arabRegional.origins).filter(
    (origin) => origin !== undefined
  );
  if (!origins.length) return state;
  const war = origins.some((origin) => origin.trajectory === "civil_war");
  const protest = origins.some((origin) => origin.trajectory === "protest");
  const authoritarian = origins.some((origin) => origin.trajectory === "authoritarian");
  const settlement = origins.every((origin) =>
    ["reform", "transition", "frozen"].includes(origin.trajectory)
  );
  const phaseLevel = war
    ? origins.some((origin) => origin.outsideSupport >= 30)
      ? 6
      : 5
    : settlement
      ? 7
      : protest
        ? 3
        : authoritarian
          ? 4
          : origins.some((origin) => origin.mobilization >= 35)
            ? 2
            : 1;
  const mean = (key: "legitimacy" | "repression" | "cohesion" | "settlement" | "reconstruction") =>
    origins.reduce((sum, origin) => sum + origin[key], 0) / origins.length;
  const max = (
    key:
      | "mobilization"
      | "opposition"
      | "civilianStrain"
      | "displacement"
      | "infrastructureDamage"
      | "extremistSpace"
  ) => Math.max(...origins.map((origin) => origin[key]));
  const changedPhase = state.phaseLevel !== phaseLevel;
  return {
    ...state,
    phaseLevel,
    phaseTurns: changedPhase ? 0 : state.phaseTurns,
    status:
      war || protest
        ? "active"
        : settlement
          ? origins.some((origin) => origin.trajectory === "frozen")
            ? "ceasefire"
            : "settled"
          : "active",
    tracks: {
      ...state.tracks,
      legitimacy: mean("legitimacy"),
      protestMobilization: max("mobilization"),
      repression: mean("repression"),
      eliteCohesion: mean("cohesion"),
      armedOpposition: max("opposition"),
      civilianStrain: max("civilianStrain"),
      displacement: max("displacement"),
      infrastructureDamage: max("infrastructureDamage"),
      extremistSpace: max("extremistSpace"),
      settlementMomentum: mean("settlement"),
      reconstruction: mean("reconstruction"),
    },
    ...(state.campaign
      ? {
          campaign: {
            ...state.campaign,
            stage: war ? "operations" : settlement ? "aftermath" : "posture",
            consequences: {
              ...state.campaign.consequences,
              refugees: max("displacement"),
              civilianStrain: max("civilianStrain"),
              infrastructureDamage: max("infrastructureDamage"),
              regionalSpillover: max("extremistSpace"),
              settlementMomentum: mean("settlement"),
            },
          },
        }
      : {}),
  };
}

/** The legacy definition represented Syria alone. Preserve that already-open
 * conflict's consequences while new regional origins keep their own signals. */
export function migrateLegacyArabOrigin(
  state: LivingConflictState,
  regional: ArabRegionalState
): ArabRegionalState {
  if (state.arabRegional || state.phaseLevel < 2 || !regional.origins.SY) return regional;
  const origin = { ...regional.origins.SY };
  const fields = {
    legitimacy: "legitimacy",
    mobilization: "protestMobilization",
    repression: "repression",
    cohesion: "eliteCohesion",
    opposition: "armedOpposition",
    civilianStrain: "civilianStrain",
    displacement: "displacement",
    infrastructureDamage: "infrastructureDamage",
    settlement: "settlementMomentum",
    reconstruction: "reconstruction",
    extremistSpace: "extremistSpace",
  } as const;
  for (const [key, track] of Object.entries(fields)) {
    const value = state.tracks?.[track];
    if (typeof value === "number" && Number.isFinite(value))
      origin[key as keyof typeof fields] = boundedArab(value);
  }
  if (state.phaseLevel === 5 || state.phaseLevel === 6) origin.trajectory = "civil_war";
  else if (state.phaseLevel === 7 && origin.displacement > 0) origin.trajectory = "frozen";
  return { ...regional, origins: { ...regional.origins, SY: origin } };
}
