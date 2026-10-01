import type { Bloc } from "@/lib/military/bloc";

const MASS_HEAT = 12;
const MASS_MULTIPLIER = 1.6;
const MASS_MULTI_BLOC_BONUS = 6;

/** Pure threat contribution from treaty-bloc forces massed at one theater. */
export function blocMassingHeat(viewerBloc: Bloc, massedBlocs: ReadonlySet<Bloc>): number {
  const enemyMassed = [...massedBlocs].some((bloc) => bloc !== viewerBloc);
  return (
    MASS_HEAT * (enemyMassed ? MASS_MULTIPLIER : 1) +
    (massedBlocs.size > 1 ? MASS_MULTI_BLOC_BONUS : 0)
  );
}
