/**
 * Real-world executive seals/emblems for the executive masthead — the
 * head-of-government (President / Prime Minister / Chancellor / Taoiseach /
 * Premier) branch emblem, rendered in place of the generated `NationalSeal`
 * on the Executive surface only (Policy / Central Bank keep their generated
 * marks). Wikimedia Commons thumbs at 330px — the allowlist-safe width the
 * state-flags fix established (Wikimedia rejects 320px). `upload.wikimedia.org`
 * is already an allowed image host (see next.config.ts remotePatterns).
 *
 * The seal component degrades to the generated `NationalSeal` if a URL fails,
 * so these are an enhancement, never a hard dependency.
 */
import type { CountryId } from "./countries";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { CN_IDENTITY } from "@/lib/countries/cn/identity";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";
import { RU_IDENTITY } from "@/lib/countries/ru/identity";
import { DD_IDENTITY } from "@/lib/countries/dd/identity";
import { NG_IDENTITY } from "@/lib/countries/ng/identity";
import { BR_IDENTITY } from "@/lib/countries/br/identity";
import { FR_IDENTITY } from "@/lib/countries/fr/identity";
import { IT_IDENTITY } from "@/lib/countries/it/identity";
import { ES_IDENTITY } from "@/lib/countries/es/identity";
import { SE_IDENTITY } from "@/lib/countries/se/identity";
import { TR_IDENTITY } from "@/lib/countries/tr/identity";
import { GR_IDENTITY } from "@/lib/countries/gr/identity";
import { AT_IDENTITY } from "@/lib/countries/at/identity";
import { FI_IDENTITY } from "@/lib/countries/fi/identity";

export interface ExecutiveSeal {
  src: string;
  alt: string;
  /**
   * How the emblem sits on the band. "medallion" (default) frames it on an
   * ivory disc so transparent/dark heraldry (e.g. the German federal eagle)
   * stays legible; "plain" drops the disc for emblems that already read on the
   * dark band (e.g. the JP PM emblem, a colored oval on its own backing).
   */
  backing?: "medallion" | "plain";
}

export const EXECUTIVE_SEALS: Partial<Record<CountryId, ExecutiveSeal>> = {
  US: US_IDENTITY.executiveSeal,
  UK: UK_IDENTITY.executiveSeal,
  DE: DE_IDENTITY.executiveSeal,
  JP: JP_IDENTITY.executiveSeal,
  IE: IE_IDENTITY.executiveSeal,
  CN: CN_IDENTITY.executiveSeal,
  BR: BR_IDENTITY.executiveSeal,
  NG: NG_IDENTITY.executiveSeal,
  // ── 1979 Cold-War roster. Wikimedia thumb paths derived from md5(filename).
  // Seals degrade to the generated NationalSeal if a URL fails, so period-emblem
  // filenames that have since moved fall back cleanly.
  RU: RU_IDENTITY.executiveSeal,
  DD: DD_IDENTITY.executiveSeal,
  FR: FR_IDENTITY.executiveSeal,
  IT: IT_IDENTITY.executiveSeal,
  ES: ES_IDENTITY.executiveSeal,
  SE: SE_IDENTITY.executiveSeal,
  TR: TR_IDENTITY.executiveSeal,
  GR: GR_IDENTITY.executiveSeal,
  AT: AT_IDENTITY.executiveSeal,
  FI: FI_IDENTITY.executiveSeal,
  HU: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Coat_of_arms_of_Hungary_(1957-1990).svg/330px-Coat_of_arms_of_Hungary_(1957-1990).svg.png",
    alt: "Coat of arms of the Hungarian People's Republic",
  },
  PL: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Coat_of_arms_of_the_People's_Republic_of_Poland.svg/330px-Coat_of_arms_of_the_People's_Republic_of_Poland.svg.png",
    alt: "Coat of arms of the Polish People's Republic",
  },
  RO: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Coat_of_arms_of_the_Socialist_Republic_of_Romania.svg/330px-Coat_of_arms_of_the_Socialist_Republic_of_Romania.svg.png",
    alt: "Coat of arms of the Socialist Republic of Romania",
  },
  YU: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Emblem_of_SFR_Yugoslavia.svg/330px-Emblem_of_SFR_Yugoslavia.svg.png",
    alt: "Emblem of SFR Yugoslavia",
  },
  BG: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Coat_of_arms_of_Bulgaria_(1971-1990).svg/330px-Coat_of_arms_of_Bulgaria_(1971-1990).svg.png",
    alt: "Coat of arms of the People's Republic of Bulgaria",
  },
  BLR: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Emblem_of_the_Byelorussian_Soviet_Socialist_Republic.svg/330px-Emblem_of_the_Byelorussian_Soviet_Socialist_Republic.svg.png",
    alt: "Emblem of the Byelorussian SSR",
  },
  UKR: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Emblem_of_the_Ukrainian_SSR.svg/330px-Emblem_of_the_Ukrainian_SSR.svg.png",
    alt: "Emblem of the Ukrainian SSR",
  },
  CS: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Coat_of_arms_of_Czechoslovakia_(1960-1990).svg/330px-Coat_of_arms_of_Czechoslovakia_(1960-1990).svg.png",
    alt: "Coat of arms of the Czechoslovak Socialist Republic",
  },
  BAL: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/State_Emblem_of_the_Soviet_Union.svg/330px-State_Emblem_of_the_Soviet_Union.svg.png",
    alt: "State Emblem of the Soviet Union (Baltic SSRs)",
  },
};

/** Real-world executive seal for a country, or null when none is configured. */
export function getExecutiveSeal(countryId: CountryId): ExecutiveSeal | null {
  return EXECUTIVE_SEALS[countryId] ?? null;
}
