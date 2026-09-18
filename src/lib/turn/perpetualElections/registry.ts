import { type CountryId } from "@/lib/constants/countries";
import { ensureBRElections, ensureBRSenateElections } from "./countries/br";
import {
  ensureCNElections,
  ensureCNGovernorElections,
  ensureCNPeoplesCongressElections,
} from "./countries/cn";
import { ensureDEElections } from "./countries/de";
import {
  ensureIECathaoirleachElections,
  ensureIEElections,
  ensureIELocalCouncilElections,
  ensureIEUachtaranElections,
} from "./countries/ie";
import { ensureNGElections } from "./countries/ng";
import { ensurePresidentialElection } from "./shared";
import { JP_ELECTIONS } from "@/lib/countries/jp/elections";
import { UK_ELECTIONS } from "@/lib/countries/uk/elections";

export interface SpawnElectionsResult {
  message: string;
  electionId?: string;
  created?: boolean;
}

export type SpawnElectionsHandler = (now: Date) => Promise<SpawnElectionsResult | void>;

export const SPAWN_ELECTIONS_REGISTRY: Partial<Record<CountryId, SpawnElectionsHandler>> = {
  US: ensurePresidentialElection,
  UK: UK_ELECTIONS.spawn,
  DE: async (now) => {
    await ensureDEElections(now);
    return { message: "DE Bundestag continuity check complete." };
  },
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
