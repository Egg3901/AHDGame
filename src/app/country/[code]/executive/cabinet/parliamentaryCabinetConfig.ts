import type { CountryId } from "@/lib/constants/countries";
import { UK_CABINET_POSITIONS } from "@/lib/constants/ukCabinet";
import { DE_CABINET_POSITIONS } from "@/lib/constants/deCabinet";
import { JP_CABINET_POSITIONS } from "@/lib/constants/jpCabinet";
import { IE_CABINET_POSITIONS } from "@/lib/constants/ieCabinet";
import { CN_CABINET_POSITIONS } from "@/lib/constants/cnCabinet";
import { RU_CABINET_POSITIONS } from "@/lib/constants/ruCabinet";
import { DD_CABINET_POSITIONS } from "@/lib/constants/ddCabinet";
import { SCO_CABINET_POSITIONS } from "@/lib/constants/scoCabinet";
import { WAL_CABINET_POSITIONS } from "@/lib/constants/walCabinet";
import { getCountryFlagUrl } from "@/lib/constants";

/** Countries that use the parliamentary direct-appointment cabinet pattern. */
export type ParliamentaryCabinetCountryId =
  "UK" | "DE" | "JP" | "IE" | "CN" | "RU" | "DD" | "SCO" | "WAL";

export interface ParliamentaryCabinetHero {
  src: string;
  alt: string;
  tagline: string;
  /**
   * Hero title — receives the imperial possessive (e.g. "His Majesty's"); UK
   * uses it to render "His Majesty's Cabinet", others ignore the parameter and
   * return a fixed title like "Cabinet of Germany".
   */
  titleFor: (possessive: string) => string;
}

export interface ParliamentaryCabinetConfig {
  countryId: ParliamentaryCabinetCountryId;
  positions: ReadonlyArray<{ id: string; name: string; order?: number }>;
  /** Back-link target (e.g. /country/uk/executive). */
  governmentLinkPath: string;
  /** Label for the chamber member in the Appoint modal. */
  chamberMemberLabel: string;
  /** Display name of the legislative chamber. */
  chamberName: string;
  /** Body paragraph beneath the hero. */
  description: string;
  hero: ParliamentaryCabinetHero;
}

export const PARLIAMENTARY_CABINET_CONFIGS: Record<
  ParliamentaryCabinetCountryId,
  ParliamentaryCabinetConfig
> = {
  UK: {
    countryId: "UK",
    positions: UK_CABINET_POSITIONS,
    governmentLinkPath: "/country/uk/executive",
    chamberMemberLabel: "Member of Parliament",
    chamberName: "House of Commons",
    description:
      "The Prime Minister appoints ministers to the Cabinet without parliamentary confirmation. Cabinet members lead government departments and collectively form the core of His Majesty's Government — key roles include the Chancellor of the Exchequer, Foreign Secretary, Home Secretary, and Secretaries of State for major policy areas. Ministers serve at the pleasure of the PM and can be dismissed at any time, but each Cabinet post can only be filled once every 24 turns.",
    hero: {
      src: getCountryFlagUrl("GB"),
      alt: "UK Government",
      tagline: "Ministers of the Crown · Appointed by the Prime Minister",
      titleFor: (possessive) => `${possessive} Cabinet`,
    },
  },
  DE: {
    countryId: "DE",
    positions: DE_CABINET_POSITIONS,
    governmentLinkPath: "/country/de/executive",
    chamberMemberLabel: "Member of the Bundestag",
    chamberName: "Bundestag",
    description:
      "The Chancellor appoints federal ministers to the cabinet without a separate Bundestag confirmation vote. Ministers steer fiscal, foreign, interior, defence, labour, transport, and environmental policy through coalition government and Bundestag confidence, and can be dismissed at any time, but each ministry can only be filled once every 24 turns.",
    hero: {
      src: "/api/images/hero/reichstag",
      alt: "Bundeskanzleramt and Reichstag",
      tagline: "Bundeskanzleramt · Federal ministers appointed by the Chancellor",
      titleFor: () => "Cabinet of Germany",
    },
  },
  JP: {
    countryId: "JP",
    positions: JP_CABINET_POSITIONS,
    governmentLinkPath: "/country/jp/executive",
    chamberMemberLabel: "Diet member",
    chamberName: "National Diet (Shugiin or Sangiin)",
    description:
      "The Prime Minister appoints ministers to the Cabinet of Japan without a separate Diet confirmation vote. Key roles include the Chief Cabinet Secretary, the Ministers of Finance and Justice, and the ministers responsible for foreign affairs, defense, the economy, and local administration. Ministers serve at the PM's pleasure and can be dismissed at any time, but each post can only be filled once every 24 turns.",
    hero: {
      src: "/api/images/hero/kantei",
      alt: "Naikaku Sori Daijin Kantei",
      tagline: "Kantei · Ministers appointed directly by the Prime Minister",
      titleFor: () => "Cabinet of Japan",
    },
  },
  IE: {
    countryId: "IE",
    positions: IE_CABINET_POSITIONS,
    governmentLinkPath: "/country/ie/executive",
    chamberMemberLabel: "Teachta Dála",
    chamberName: "Dáil Éireann",
    description:
      "The Taoiseach nominates ministers to the Government of Ireland, formally appointed by the Uachtarán on the Taoiseach's advice without a separate Dáil confirmation vote. Ministers lead departments covering finance, foreign affairs, enterprise, health, education, housing, justice, and defence, operating through coalition government and Dáil confidence. Ministers serve at the Taoiseach's pleasure and can be dismissed at any time, but each ministry can only be filled once every 24 turns.",
    hero: {
      // Use the IE flag until a dedicated Government Buildings hero image is
      // registered in the /api/images/hero/[slug] route (backlog polish item).
      // Mirrors the UK pattern at line 50.
      src: getCountryFlagUrl("IE"),
      alt: "Government Buildings, Merrion Street, Dublin",
      tagline: "Tithe an Rialtais · Ministers appointed by the Taoiseach",
      titleFor: () => "Government of Ireland",
    },
  },
  CN: {
    countryId: "CN",
    positions: CN_CABINET_POSITIONS,
    governmentLinkPath: "/country/cn/executive",
    chamberMemberLabel: "NPC Delegate",
    chamberName: "National People's Congress (NPC)",
    description:
      "The Premier appoints ministers to the State Council without a separate NPC confirmation vote. Key roles include the Vice Premier, State Councillors, and the ministers of foreign affairs, finance, defense, public security, commerce, education, and health. Ministers can be dismissed at any time, but each post can only be filled once every 24 turns.",
    hero: {
      src: "/api/images/hero/zhongnanhai",
      alt: "Xinhua Gate of Zhongnanhai, Beijing",
      tagline: "Zhongnanhai · Ministers appointed directly by the Premier",
      titleFor: () => "State Council of China",
    },
  },
  RU: {
    countryId: "RU",
    positions: RU_CABINET_POSITIONS,
    governmentLinkPath: "/country/ru/executive",
    chamberMemberLabel: "Supreme Soviet Deputy",
    chamberName: "Supreme Soviet",
    description:
      "The Chairman of the Council of Ministers appoints ministers from the deputies of the Supreme Soviet without a separate confirmation vote. Key seats include the First Deputy Chairman, the Chairman of Gosplan, the Council's liaison to Gosbank, and the ministers of foreign affairs, defence, finance, foreign and internal trade, agriculture, and heavy industry. Ministers can be dismissed at any time, but each post can only be filled once every 24 turns.",
    hero: {
      src: "/api/images/hero/kremlin",
      alt: "The Moscow Kremlin — seat of the Council of Ministers",
      tagline: "The Kremlin · Ministers appointed by the Chairman",
      titleFor: () => "Council of Ministers",
    },
  },
  DD: {
    countryId: "DD",
    positions: DD_CABINET_POSITIONS,
    governmentLinkPath: "/country/dd/executive",
    chamberMemberLabel: "Volkskammer Deputy",
    chamberName: "Volkskammer",
    description:
      "The General Secretary appoints ministers to the Council of Ministers (Ministerrat der DDR) from the deputies of the Volkskammer without a separate confirmation vote. Key seats include the First Deputy Chairman, the Chairman of the State Planning Commission, the Council's liaison to the Staatsbank, the Minister for State Security, and the ministers of foreign affairs, national defence, finance, foreign and internal trade, and agriculture. Ministers can be dismissed at any time, but each post can only be filled once every 24 turns.",
    hero: {
      src: "/api/images/hero/altes-stadthaus",
      alt: "Altes Stadthaus, Berlin — seat of the Council of Ministers",
      tagline: "Altes Stadthaus · Ministers appointed by the General Secretary",
      titleFor: () => "Council of Ministers of the GDR",
    },
  },
  SCO: {
    countryId: "SCO",
    positions: SCO_CABINET_POSITIONS,
    governmentLinkPath: "/country/sco/executive",
    chamberMemberLabel: "Member of the Scottish Parliament",
    chamberName: "Scottish Parliament (Holyrood)",
    description:
      "The First Minister appoints Cabinet Secretaries to the Scottish Government from Bute House without a separate Holyrood confirmation vote. Cabinet Secretaries lead directorates covering finance, external affairs, justice and home affairs, health, education, the economy, communities, transport, net zero, and social justice, governing through a Holyrood majority. They serve at the First Minister's pleasure and can be dismissed at any time, but each post can only be filled once every 24 turns.",
    hero: {
      src: "/api/images/hero/bute-house",
      alt: "Bute House, Edinburgh",
      tagline: "Bute House · Cabinet Secretaries appointed by the First Minister",
      titleFor: () => "Scottish Government",
    },
  },
  WAL: {
    countryId: "WAL",
    positions: WAL_CABINET_POSITIONS,
    governmentLinkPath: "/country/wal/executive",
    chamberMemberLabel: "Member of the Senedd",
    chamberName: "Senedd Cymru (Welsh Parliament)",
    description:
      "The First Minister appoints Cabinet Secretaries to the Welsh Government without a separate Senedd confirmation vote. Cabinet Secretaries lead groups covering finance, external affairs and the constitution, justice and home affairs, health, education, the economy and Welsh language, housing, transport, climate change, and social justice, governing through a Senedd majority. They serve at the First Minister's pleasure and can be dismissed at any time, but each post can only be filled once every 24 turns.",
    hero: {
      src: "/api/images/hero/senedd",
      alt: "Senedd, Cardiff",
      tagline: "Senedd · Cabinet Secretaries appointed by the First Minister",
      titleFor: () => "Welsh Government",
    },
  },
};

/** Type guard for the dispatcher. */
export function isParliamentaryCabinetCountry(
  countryId: CountryId
): countryId is ParliamentaryCabinetCountryId {
  return countryId in PARLIAMENTARY_CABINET_CONFIGS;
}
