import type { LivingConflictState } from "../types";
import { ARAB_UPRISINGS_KEY } from "./arabOrigins";

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
