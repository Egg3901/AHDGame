/**
 * Per-country display surface for the shared one-party-state executive hub
 * (`OnePartyExecutiveHub`). The CN entry preserves the exact copy the
 * dedicated CN hub used to render; RU and DD carry bespoke CPSU / SED copy at
 * the same fidelity. Any one-party country without an entry gets a complete
 * surface derived from `COUNTRY_CONFIGS`, so adding one does not require a
 * per-country hub rebuild.
 */
import { getCountryConfig, type CountryId } from "./countries";
import { getExecutiveSurface } from "./executiveSurface";

export interface OnePartyExecutivePlaque {
  title: string;
  sealGlyph: string;
  vacancyNote: string;
  tenureLine?: string;
}

export interface OnePartyExecutiveSurface {
  /** Head-of-government title for the actions banner and premier plaque. */
  executiveTitle: string;
  /** Chamber-member label in the Appoint/No-Confidence banner copy. */
  memberLabel: string;
  /** Ruling party display names for head-of-state copy. */
  rulingPartyName: string;
  rulingPartyShortName: string;
  /** Ceremonial head of state (CN: President, auto-synced from the ruling
   * party chair). The hub fills the vacancy note / tenure line with the
   * resolved party role label at render time when placeholders are present. */
  headOfStatePlaque: OnePartyExecutivePlaque;
  /** Formal head of the legislature — rendered only when a `congressLeaders`
   * role exists for the country (CN: chair_npcsc). */
  legislatureChairPlaque?: OnePartyExecutivePlaque & { congressLeaderRole: string };
  /** Advisory-body chair (CN: chair_cppcc). */
  advisoryChairPlaque?: OnePartyExecutivePlaque & { congressLeaderRole: string };
  premierPlaque: OnePartyExecutivePlaque;
  oppositionNote: string;
  seatsPanel: { title: string; emptyText: string };
  confidencePanel: { title: string; description: string };
  hero: { image: string; alt: string; title: string; tagline: string; breadcrumbLast: string };
}

const SURFACES: Partial<Record<CountryId, OnePartyExecutiveSurface>> = {
  CN: {
    executiveTitle: "Premier",
    memberLabel: "NPC Delegate",
    rulingPartyName: "Chinese Communist Party",
    rulingPartyShortName: "CCP",
    headOfStatePlaque: {
      title: "President",
      sealGlyph: "主",
      // The hub substitutes {roleLabel} with getPartyRoleLabel(countryId, "chair").
      vacancyNote: "Auto-populated as the {roleLabel} of the CCP; vacant when none is seated.",
      tenureLine: "{roleLabel}, Chinese Communist Party",
    },
    legislatureChairPlaque: {
      title: "Chairman of the NPC Standing Committee",
      sealGlyph: "委",
      vacancyNote: "Elected by NPC delegates on the National People's Congress page.",
      tenureLine: "presiding officer of the National People's Congress",
      congressLeaderRole: "chair_npcsc",
    },
    advisoryChairPlaque: {
      title: "Chairman of the CPPCC",
      sealGlyph: "协",
      vacancyNote:
        "Selected by the ruling party's NPC delegates on the National People's Congress page.",
      tenureLine: "heads the People's Political Consultative Conference",
      congressLeaderRole: "chair_cppcc",
    },
    premierPlaque: {
      title: "Premier",
      sealGlyph: "总",
      vacancyNote: "A qualifying party or coalition chair may nominate a Premier.",
    },
    oppositionNote: "The leader of the largest opposition party in the NPC.",
    seatsPanel: { title: "NPC seats by party", emptyText: "No NPC delegates elected yet." },
    confidencePanel: {
      title: "Ruling-Party Confidence",
      description:
        "Internal CPC confidence in the Premier. Drifts each turn from enacted-bill alignment with the party's priority profile and any recorded purge events.",
    },
    hero: {
      image: "/api/images/hero/zhongnanhai",
      alt: "Xinhua Gate of Zhongnanhai, Beijing",
      title: "State Council of China",
      tagline: "Zhongnanhai · Premier, State Council, and NPC confidence",
      breadcrumbLast: "State Council",
    },
  },
  RU: {
    executiveTitle: "Premier",
    memberLabel: "Supreme Soviet Deputy",
    rulingPartyName: "Communist Party of the Soviet Union",
    rulingPartyShortName: "CPSU",
    headOfStatePlaque: {
      title: "Chairman of the Presidium",
      sealGlyph: "П",
      vacancyNote:
        "Elected by a joint sitting of the Supreme Soviet whenever the office falls vacant.",
      tenureLine: "Chairman of the Presidium of the Supreme Soviet",
    },
    premierPlaque: {
      title: "Premier",
      sealGlyph: "С",
      vacancyNote: "A qualifying party or coalition chair may nominate a Premier.",
    },
    oppositionNote: "The leader of the largest opposition party in the Supreme Soviet.",
    seatsPanel: {
      title: "Supreme Soviet seats by party",
      emptyText: "No Supreme Soviet deputies elected yet.",
    },
    confidencePanel: {
      title: "Ruling-Party Confidence",
      description:
        "Internal CPSU confidence in the Premier. Drifts each turn from enacted-bill alignment with the party's priority profile and any recorded purge events.",
    },
    hero: {
      image: "/api/images/hero/kremlin",
      alt: "The Kremlin, Moscow",
      title: "Government of the Soviet Union",
      tagline: "The Kremlin · Premier, Council of Ministers, and Supreme Soviet confidence",
      breadcrumbLast: "Council of Ministers",
    },
  },
  DD: {
    executiveTitle: "General Secretary",
    memberLabel: "Volkskammer Deputy",
    rulingPartyName: "Socialist Unity Party of Germany",
    rulingPartyShortName: "SED",
    headOfStatePlaque: {
      title: "Chairman of the Council of State",
      sealGlyph: "SR",
      // The hub substitutes {roleLabel} with getPartyRoleLabel(countryId, "chair").
      vacancyNote: "Auto-populated as the {roleLabel} of the SED; vacant when none is seated.",
      tenureLine: "{roleLabel}, Socialist Unity Party of Germany",
    },
    premierPlaque: {
      title: "General Secretary",
      sealGlyph: "GS",
      vacancyNote: "A qualifying party or coalition chair may nominate a General Secretary.",
    },
    // Not "opposition": the CDU, LDPD, NDPD and DBD sat in the National Front
    // alongside the SED and held Volkskammer seats by allocation, not contest.
    // The generic surface calls this seat the opposition leader; in the DDR the
    // largest non-SED bloc party is a junior partner, so the copy says so.
    oppositionNote: "The leader of the largest National Front bloc party in the Volkskammer.",
    seatsPanel: {
      title: "Volkskammer seats by bloc party",
      emptyText: "No Volkskammer deputies elected yet.",
    },
    confidencePanel: {
      title: "Ruling-Party Confidence",
      description:
        "Internal SED confidence in the General Secretary. Drifts each turn from enacted-bill alignment with the party's priority profile and any recorded purge events.",
    },
    hero: {
      image: "/api/images/hero/altes-stadthaus",
      alt: "Altes Stadthaus, Berlin",
      title: "Government of East Germany",
      tagline: "Berlin · General Secretary, Council of Ministers, and Volkskammer confidence",
      breadcrumbLast: "Council of Ministers",
    },
  },
};

export function getOnePartyExecutiveSurface(countryId: CountryId): OnePartyExecutiveSurface {
  const bespoke = SURFACES[countryId];
  if (bespoke) return bespoke;

  const config = getCountryConfig(countryId);
  const surface = getExecutiveSurface(countryId);
  const executiveTitle = config.executiveTitle ?? "Premier";
  const chamberShort = config.legislature?.lowerChamber?.shortName ?? "Congress";
  const headOfStateVacancyNote =
    config.headOfStateSelection === "partyChairSync"
      ? "Auto-populated as the {roleLabel} of the ruling party; vacant when none is seated."
      : config.headOfStateSelection === "legislatureAppointment"
        ? "Elected by the legislature through a head-of-state appointment vote."
        : "No separate head-of-state seat is configured for this country.";
  return {
    executiveTitle,
    memberLabel: `${chamberShort} Delegate`,
    rulingPartyName: "the ruling party",
    rulingPartyShortName: "ruling party",
    headOfStatePlaque: {
      title: "Head of State",
      sealGlyph: "HS",
      vacancyNote: headOfStateVacancyNote,
      tenureLine:
        config.headOfStateSelection === "partyChairSync"
          ? "{roleLabel} of the ruling party"
          : undefined,
    },
    premierPlaque: {
      title: executiveTitle,
      sealGlyph: executiveTitle.charAt(0).toUpperCase(),
      vacancyNote: `A qualifying party or coalition chair may nominate a ${executiveTitle}.`,
    },
    oppositionNote: `The leader of the largest opposition party in the ${chamberShort}.`,
    seatsPanel: {
      title: `${chamberShort} seats by party`,
      emptyText: `No ${chamberShort} delegates elected yet.`,
    },
    confidencePanel: {
      title: "Ruling-Party Confidence",
      description:
        "Internal ruling-party confidence in the head of government. Drifts each turn from enacted-bill alignment with the party's priority profile and any recorded purge events.",
    },
    hero: {
      image: surface.heroImage,
      alt: surface.heroAlt,
      title: `Government of ${config.name}`,
      tagline: `${executiveTitle}, cabinet, and ${config.legislature?.name ?? "congress"} confidence`,
      breadcrumbLast: "Executive",
    },
  };
}
