import type { CountryId } from "@/lib/constants/countries";

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

const US: LegislativeProcess = {
  executive: {
    title: "President",
    canVeto: true,
    signLabel: "President signs",
    vetoLabel: "Veto",
    signNote: "The President may sign the bill into law or return it with a veto.",
    override: {
      threshold: "two-thirds",
      body: "both chambers",
      note: "A two-thirds vote in both the House and Senate overrides a presidential veto.",
    },
  },
  upperNote:
    "Both chambers are co-equal — the bill must pass the House and the Senate in identical form.",
  dissolution: null,
  quirks: [
    {
      icon: "shield",
      title: "Presidential veto",
      body: "Enrolled bills go to the President's desk to be signed or vetoed.",
    },
    {
      icon: "users",
      title: "Veto override",
      body: "Congress can override a veto with a two-thirds majority in both chambers.",
    },
    {
      icon: "scale",
      title: "Bicameral identical text",
      body: "House and Senate must agree on the same text before enrollment.",
    },
  ],
  seatingStyle: "hemicycle",
};

const UK: LegislativeProcess = {
  executive: {
    title: "The Crown",
    canVeto: false,
    signLabel: "Royal Assent",
    signNote: "Royal Assent is a constitutional formality — it has not been refused since 1708.",
    override: null,
  },
  upperNote:
    "The Lords may revise or delay a bill, but under the Parliament Acts the Commons ultimately prevails — and the Lords cannot block a money bill.",
  dissolution: {
    actor: "Prime Minister",
    body: "The PM may call a snap general election. Parliament is dissolved and all bills still in progress fall.",
  },
  quirks: [
    {
      icon: "building",
      title: "Commons supremacy",
      body: "The Lords can delay but not block; the Parliament Acts let the Commons override.",
    },
    {
      icon: "bolt",
      title: "Snap election",
      body: "A PM-called general election dissolves Parliament and kills all active legislation.",
    },
    {
      icon: "doc",
      title: "Royal Assent",
      body: "Assent by the Crown is automatic — a formality, never refused in practice.",
    },
  ],
  seatingStyle: "benches",
};

const DE: LegislativeProcess = {
  executive: {
    title: "Federal President",
    canVeto: false,
    signLabel: "Presidential signature",
    signNote:
      "The Federal President signs and promulgates the law, and may decline only on constitutional grounds.",
    override: null,
  },
  upperNote:
    "The Bundesrat represents the Länder. Consent bills require its approval; for objection bills it can be overruled by the Bundestag.",
  dissolution: {
    actor: "Chancellor",
    body: "There is no free dissolution. A constructive vote of no confidence must name a successor Chancellor (Art. 67).",
  },
  quirks: [
    {
      icon: "building",
      title: "Bundesrat consent",
      body: "Bills affecting the Länder need Bundesrat approval; others it may only delay.",
    },
    {
      icon: "users",
      title: "Constructive no-confidence",
      body: "The Chancellor can only be removed by electing a replacement in the same vote.",
    },
    {
      icon: "doc",
      title: "Promulgation",
      body: "The Federal President's signature is largely ceremonial.",
    },
  ],
  seatingStyle: "hemicycle",
};

const JP: LegislativeProcess = {
  executive: {
    title: "The Emperor",
    canVeto: false,
    signLabel: "Promulgation",
    signNote: "The bill is promulgated by the Emperor on the Cabinet's advice — a formality.",
    override: null,
  },
  upperNote:
    "If the Sangiin (Councillors) rejects or amends a bill, the Shūgiin (Representatives) can override with a two-thirds majority.",
  dissolution: {
    actor: "Prime Minister",
    body: "The PM may dissolve the Shūgiin and call an election; bills in progress lapse.",
  },
  quirks: [
    {
      icon: "users",
      title: "Shūgiin override",
      body: "The lower house can override the Sangiin with a two-thirds vote.",
    },
    {
      icon: "doc",
      title: "Cabinet bills",
      body: "Most legislation is Cabinet-submitted (Kakuhō), not member-introduced.",
    },
    {
      icon: "bolt",
      title: "Dissolution",
      body: "The PM can dissolve the Shūgiin, ending all pending business.",
    },
  ],
  seatingStyle: "hemicycle",
};

const IE: LegislativeProcess = {
  executive: {
    title: "Enactment",
    canVeto: false,
    signLabel: "Signed into law",
    signNote: "Once passed by the Dáil, the bill is enacted into law.",
    override: null,
  },
  upperNote:
    "The Seanad may revise or delay a bill, but the Dáil ultimately prevails. Seanad business is not player-managed.",
  dissolution: {
    actor: "Taoiseach",
    body: "The Taoiseach may seek a dissolution of the Dáil; a general election is called and all bills in progress fall.",
  },
  quirks: [
    {
      icon: "building",
      title: "Dáil supremacy",
      body: "The Dáil drives all legislation; the Seanad can delay but not block.",
    },
    {
      icon: "bolt",
      title: "Dissolution",
      body: "A Taoiseach-sought election dissolves the Dáil and ends pending bills.",
    },
  ],
  seatingStyle: "horseshoe",
};

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

const CN: LegislativeProcess = {
  executive: {
    title: "President",
    canVeto: false,
    signLabel: "Promulgation",
    signNote:
      "Adopted laws are promulgated by the President by order. The NPC is the highest organ of state power.",
    override: null,
  },
  upperNote: null,
  dissolution: null,
  quirks: [
    {
      icon: "building",
      title: "NPC supremacy",
      body: "The National People's Congress is constitutionally the highest organ of state power.",
    },
    {
      icon: "users",
      title: "Standing Committee",
      body: "Between sessions, the NPC Standing Committee exercises legislative authority.",
    },
    {
      icon: "shield",
      title: "Party leadership",
      body: "Legislation advances under the leadership of the Communist Party of China.",
    },
  ],
  seatingStyle: "hemicycle",
};

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
  US,
  UK,
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
