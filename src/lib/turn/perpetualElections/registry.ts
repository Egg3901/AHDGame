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
import {
  ensureJPCouncillorElections,
  ensureJPElections,
  ensureJPGovernorElections,
} from "./countries/jp";
import { ensureNGElections } from "./countries/ng";
import {
  ensureUKElections,
  ensureUKGovernorElections,
  ensureUKRegionalCouncilElections,
} from "./countries/uk";
import { ensurePresidentialElection } from "./shared";

export interface SpawnElectionsResult {
  message: string;
  electionId?: string;
  created?: boolean;
}

export type SpawnElectionsHandler = (now: Date) => Promise<SpawnElectionsResult | void>;

export const SPAWN_ELECTIONS_REGISTRY: Partial<Record<CountryId, SpawnElectionsHandler>> = {
  US: ensurePresidentialElection,
  UK: async (now) => {
    // Westminster Commons + devolved Regional Councils + Governor seats.
    await ensureUKElections(now);
    await ensureUKRegionalCouncilElections(now);
    await ensureUKGovernorElections(now);
    return { message: "UK Commons / Regional Council / Governor continuity check complete." };
  },
  DE: async (now) => {
    await ensureDEElections(now);
    return { message: "DE Bundestag continuity check complete." };
  },
  JP: async (now) => {
    // Shugiin (lower) + Sangiin (upper, classOverride omitted = natural class) +
    // prefectural Governor seats.
    await ensureJPElections(now);
    await ensureJPCouncillorElections(now);
    await ensureJPGovernorElections(now);
    return { message: "JP Shugiin / Sangiin / Governor continuity check complete." };
  },
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
