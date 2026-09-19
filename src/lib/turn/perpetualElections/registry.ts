import { type CountryId } from "@/lib/constants/countries";
import { JP_ELECTIONS } from "@/lib/countries/jp/elections";
import { UK_ELECTIONS } from "@/lib/countries/uk/elections";
import { US_ELECTIONS } from "@/lib/countries/us/elections";
import { DE_ELECTIONS } from "@/lib/countries/de/elections";
import { CN_ELECTIONS } from "@/lib/countries/cn/elections";
import { IE_ELECTIONS } from "@/lib/countries/ie/elections";
import { NG_ELECTIONS } from "@/lib/countries/ng/elections";
import { BR_ELECTIONS } from "@/lib/countries/br/elections";

export interface SpawnElectionsResult {
  message: string;
  electionId?: string;
  created?: boolean;
}

export type SpawnElectionsHandler = (
  now: Date,
  currentTurn?: number
) => Promise<SpawnElectionsResult | void>;

export const SPAWN_ELECTIONS_REGISTRY: Partial<Record<CountryId, SpawnElectionsHandler>> = {
  US: US_ELECTIONS.spawn,
  UK: UK_ELECTIONS.spawn,
  DE: DE_ELECTIONS.spawn,
  JP: JP_ELECTIONS.spawn,
  CN: CN_ELECTIONS.spawn,
  BR: BR_ELECTIONS.spawn,
  NG: NG_ELECTIONS.spawn,
  IE: IE_ELECTIONS.spawn,
};
