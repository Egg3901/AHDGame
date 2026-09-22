import type { CountryId } from "@/lib/constants/countries";
import { JP_LEGISLATIVE_PROCESS } from "@/lib/countries/jp/institutionsFacts";
import { DE_LEGISLATIVE_PROCESS } from "@/lib/countries/de/institutionsFacts";
import { CN_LEGISLATIVE_PROCESS } from "@/lib/countries/cn/institutionsFacts";
import { IE_LEGISLATIVE_PROCESS } from "@/lib/countries/ie/institutionsFacts";
import { US_LEGISLATIVE_PROCESS } from "@/lib/countries/us/institutionsFacts";
import { UK_LEGISLATIVE_PROCESS } from "@/lib/countries/uk/institutionsFacts";

/** Chamber seating geometry used by the composition + vote-seating charts. */
export type SeatingStyle = "hemicycle" | "benches" | "horseshoe";

export interface ProcessQuirk {
  /** icon key understood by the detail page's icon set */
  icon: string;
  title: string;
  body: string;
}

export interface ExecutiveProcess {
  title: string;
  canVeto: boolean;
  signLabel: string;
  vetoLabel?: string;
  signNote: string;
  override: { threshold: string; body: string; note: string } | null;
}

export interface DissolutionProcess {
  actor: string;
  body: string;
}

export interface LegislativeProcess {
  executive: ExecutiveProcess;
  /** bicameral relationship note, or null for unicameral chambers */
  upperNote: string | null;
  dissolution: DissolutionProcess | null;
  quirks: ProcessQuirk[];
  seatingStyle: SeatingStyle;
}

const DE: LegislativeProcess = DE_LEGISLATIVE_PROCESS;

/**
 * Forwarder. Japan's legislative process moved to the country folder in D3.
 *
 * ⚠️ Declared as a module-level const rather than an inline key: the registry
 * below composes from these consts by shorthand, so the usual "replace the JP
 * entry" pass does not apply here.
 */
const JP: LegislativeProcess = JP_LEGISLATIVE_PROCESS;

const IE: LegislativeProcess = IE_LEGISLATIVE_PROCESS;

/** Sweden 1953 bicameral Riksdag — same revise/delay shape as IE's Seanad. */
const SE_1953: LegislativeProcess = {
  executive: {
    title: "The King",
    canVeto: false,
    signLabel: "Royal assent",
    signNote: "Assent by the King is a constitutional formality.",
    override: null,
  },
  upperNote:
    "The First Chamber may revise or delay a bill, but the Second Chamber ultimately prevails. First Chamber business is not player-managed.",
  dissolution: {
    actor: "Prime Minister",
    body: "The PM may seek a dissolution of the Second Chamber; a general election is called and all bills in progress fall.",
  },
  quirks: [
    {
      icon: "building",
      title: "Second Chamber supremacy",
      body: "The Second Chamber drives legislation; the First Chamber can delay but not block.",
    },
    {
      icon: "users",
      title: "Indirect upper house",
      body: "Första kammaren is elected by county and city councils on staggered terms — not by direct popular vote.",
    },
  ],
  seatingStyle: "hemicycle",
};

const CN: LegislativeProcess = CN_LEGISLATIVE_PROCESS;

const DEFAULT_PROCESS: LegislativeProcess = {
  executive: {
    title: "Head of State",
    canVeto: false,
    signLabel: "Assent",
    signNote: "Passed bills receive formal assent before taking effect.",
    override: null,
  },
  upperNote: null,
  dissolution: null,
  quirks: [],
  seatingStyle: "hemicycle",
};

export const LEGISLATIVE_PROCESS: Partial<Record<CountryId, LegislativeProcess>> = {
  US: US_LEGISLATIVE_PROCESS,
  UK: UK_LEGISLATIVE_PROCESS,
  DE,
  JP,
  IE,
  CN,
};

/**
 * Legislative-process flavour for UI (seating style, quirks, upper-chamber note).
 * Pass `preset` when the country's process is era-conditional (SE 1953 bicameral
 * vs 1979+ unicameral); without it SE falls through to {@link DEFAULT_PROCESS}.
 */
export function getLegislativeProcess(countryId: CountryId, preset?: string): LegislativeProcess {
  if (countryId === "SE" && preset === "1953-default") return SE_1953;
  return LEGISLATIVE_PROCESS[countryId] ?? DEFAULT_PROCESS;
}
