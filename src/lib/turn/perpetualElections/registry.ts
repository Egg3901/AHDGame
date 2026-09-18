import { type CountryId } from "@/lib/constants/countries";
import { ensureBRElections, ensureBRSenateElections } from "./countries/br";
import {
  ensureCNElections,
  ensureCNGovernorElections,
  ensureCNPeoplesCongressElections,
} from "./countries/cn";
import {
  ensureIECathaoirleachElections,
  ensureIEElections,
  ensureIELocalCouncilElections,
  ensureIEUachtaranElections,
} from "./countries/ie";
import { ensureNGElections } from "./countries/ng";
import { JP_ELECTIONS } from "@/lib/countries/jp/elections";
import { UK_ELECTIONS } from "@/lib/countries/uk/elections";
import { US_ELECTIONS } from "@/lib/countries/us/elections";
import { DE_ELECTIONS } from "@/lib/countries/de/elections";

export interface SpawnElectionsResult {
  message: string;
  electionId?: string;
  created?: boolean;
}

export type SpawnElectionsHandler = (now: Date) => Promise<SpawnElectionsResult | void>;

export const SPAWN_ELECTIONS_REGISTRY: Partial<Record<CountryId, SpawnElectionsHandler>> = {
  US: US_ELECTIONS.spawn,
  UK: UK_ELECTIONS.spawn,
  DE: DE_ELECTIONS.spawn,
  JP: JP_ELECTIONS.spawn,
  CN: async (now) => {
    // National NPC Delegates + Provincial People's Congress + macro-region Governor.
    await ensureCNElections(now);
    await ensureCNPeoplesCongressElections(now);
    await ensureCNGovernorElections(now);
    return { message: "CN NPC / Provincial Congress / Governor continuity check complete." };
  },
  BR: async (now) => {
    await ensureBRElections(now);
    await ensureBRSenateElections(now);
    return { message: "BR Câmara / Senate continuity check complete." };
  },
  NG: async (now) => {
    await ensureNGElections(now);
    return { message: "NG election continuity check complete." };
  },
  IE: async (now) => {
    await ensureIEElections(now);
    await ensureIEUachtaranElections(now);
    await ensureIELocalCouncilElections(now);
    await ensureIECathaoirleachElections(now);
    return {
      message: "IE Dáil, Uachtarán, Local Council, and Cathaoirleach continuity check complete.",
    };
  },
};
