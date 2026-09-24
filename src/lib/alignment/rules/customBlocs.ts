/**
 * Player-founded Blocs create independent alignment poles. Their founder starts
 * committed to the new pole, and each Bloc contributes one accession channel.
 */
import {
  customAlignmentPoleId,
  resolveAlignmentEra,
  type AlignmentChannel,
  type AlignmentEra,
  type AlignmentPole,
  type AlignmentPoleId,
  type CustomAlignmentPoleToken,
} from "@/lib/constants/alignmentEras";
import type { CountryId } from "@/lib/constants/countries";
import { normalizeShares, type AlignmentShares } from "@/lib/alignment/normalize";

export const CUSTOM_BLOC_FOUNDING_SHARE = 60;

export interface CustomBlocTopologyInput {
  organizationId: string;
  name: string;
  shortName: string;
  founderCountryId: CountryId;
  accentToken: CustomAlignmentPoleToken;
}

export interface AlignmentTopology {
  era: AlignmentEra;
  poles: AlignmentPoleId[];
  channels: AlignmentChannel[];
  poleDefinitions: Map<AlignmentPoleId, AlignmentPole>;
}

export function buildAlignmentTopology(
  year: number,
  builtInDefinitions: readonly AlignmentPole[],
  customBlocs: readonly CustomBlocTopologyInput[]
): AlignmentTopology {
  const era = resolveAlignmentEra(year);
  const poleDefinitions = new Map<AlignmentPoleId, AlignmentPole>(
    builtInDefinitions.map((pole) => [pole.id, pole])
  );
  const customPoles: AlignmentPoleId[] = [];
  const customChannels: AlignmentChannel[] = [];

  for (const bloc of customBlocs) {
    const poleId = customAlignmentPoleId(bloc.organizationId);
    if (poleDefinitions.has(poleId)) continue;
    const definition: AlignmentPole = {
      id: poleId,
      label: bloc.name,
      shortLabel: bloc.shortName,
      accentToken: bloc.accentToken,
      leaderCountryId: bloc.founderCountryId,
    };
    poleDefinitions.set(poleId, definition);
    customPoles.push(poleId);
    customChannels.push({
      organizationId: bloc.organizationId,
      poleId,
      weight: 1,
      alignmentAccession: true,
    });
  }

  return {
    era,
    poles: [...era.poles, ...customPoles],
    channels: [...era.channels, ...customChannels],
    poleDefinitions,
  };
}

/** Rebalances the founder's existing distribution so the new pole owns an exact share. */
export function foundCustomBlocPole(params: {
  current: AlignmentShares;
  currentPoles: readonly AlignmentPoleId[];
  poleId: AlignmentPoleId;
  foundingShare?: number;
}): AlignmentShares {
  const foundingShare = params.foundingShare ?? CUSTOM_BLOC_FOUNDING_SHARE;
  const retained = Math.max(0, 100 - foundingShare) / 100;
  const raw: Partial<Record<AlignmentPoleId, number>> = { [params.poleId]: foundingShare };
  for (const pole of params.currentPoles) {
    if (pole === params.poleId) continue;
    raw[pole] = (params.current.shares[pole] ?? 0) * retained;
  }
  return normalizeShares(raw, [...params.currentPoles, params.poleId]);
}
