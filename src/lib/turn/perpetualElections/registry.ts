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

export type SpawnElectionsHandler = (
  now: Date,
  currentTurn?: number
) => Promise<SpawnElectionsResult | void>;

export const SPAWN_ELECTIONS_REGISTRY: Partial<Record<CountryId, SpawnElectionsHandler>> = {
  US: (now, currentTurn) => ensurePresidentialElection(now, currentTurn),
  UK: async (now, currentTurn) => {
    // Westminster Commons + devolved Regional Councils + Governor seats.
    await ensureUKElections(now, currentTurn);
    await ensureUKRegionalCouncilElections(now, currentTurn);
    await ensureUKGovernorElections(now, currentTurn);
    return { message: "UK Commons / Regional Council / Governor continuity check complete." };
  },
  DE: async (now, currentTurn) => {
    await ensureDEElections(now, currentTurn);
    return { message: "DE Bundestag continuity check complete." };
  },
  JP: async (now, currentTurn) => {
    // Shugiin (lower) + Sangiin (upper, classOverride omitted = natural class) +
    // prefectural Governor seats.
    await ensureJPElections(now, currentTurn);
    await ensureJPCouncillorElections(now, undefined, currentTurn);
    await ensureJPGovernorElections(now, currentTurn);
    return { message: "JP Shugiin / Sangiin / Governor continuity check complete." };
  },
  CN: async (now, currentTurn) => {
    // National NPC Delegates + Provincial People's Congress + macro-region Governor.
    await ensureCNElections(now, currentTurn);
    await ensureCNPeoplesCongressElections(now, currentTurn);
    await ensureCNGovernorElections(now, currentTurn);
    return { message: "CN NPC / Provincial Congress / Governor continuity check complete." };
  },
  BR: async (now, currentTurn) => {
    await ensureBRElections(now, currentTurn);
    await ensureBRSenateElections(now, currentTurn);
    return { message: "BR Câmara / Senate continuity check complete." };
  },
  NG: async (now, currentTurn) => {
    await ensureNGElections(now, currentTurn);
    return { message: "NG election continuity check complete." };
  },
  IE: async (now, currentTurn) => {
    await ensureIEElections(now, currentTurn);
    await ensureIEUachtaranElections(now, currentTurn);
    await ensureIELocalCouncilElections(now, currentTurn);
    await ensureIECathaoirleachElections(now, currentTurn);
    return {
      message: "IE Dáil, Uachtarán, Local Council, and Cathaoirleach continuity check complete.",
    };
  },
};
