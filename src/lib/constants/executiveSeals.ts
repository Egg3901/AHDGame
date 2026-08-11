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

const EXECUTIVE_SEALS: Partial<Record<CountryId, ExecutiveSeal>> = {
  US: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Seal_of_the_President_of_the_United_States.svg/330px-Seal_of_the_President_of_the_United_States.svg.png",
    alt: "Seal of the President of the United States",
  },
  UK: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28St_Edwards_Crown%29.svg/330px-Royal_Coat_of_Arms_of_the_United_Kingdom_%28HM_Government%29_%28St_Edwards_Crown%29.svg.png",
    alt: "Royal Arms of His Majesty's Government",
  },
  DE: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Bundesadler_Bundesorgane.svg/330px-Bundesadler_Bundesorgane.svg.png",
    alt: "Federal eagle of Germany",
  },
  JP: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Emblem_of_the_Prime_Minister_of_Japan.svg/330px-Emblem_of_the_Prime_Minister_of_Japan.svg.png",
    alt: "Emblem of the Prime Minister of Japan",
    // Self-contained colored oval — reads on the dark band without a disc.
    backing: "plain",
  },
  IE: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Coat_of_arms_of_Ireland.svg/330px-Coat_of_arms_of_Ireland.svg.png",
    alt: "Coat of arms of Ireland",
  },
  CN: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/National_Emblem_of_the_People%27s_Republic_of_China.svg/330px-National_Emblem_of_the_People%27s_Republic_of_China.svg.png",
    alt: "National Emblem of the People's Republic of China",
  },
  BR: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Coat_of_arms_of_Brazil.svg/330px-Coat_of_arms_of_Brazil.svg.png",
    alt: "Coat of arms of Brazil",
  },
  NG: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Coat_of_arms_of_Nigeria.svg/330px-Coat_of_arms_of_Nigeria.svg.png",
    alt: "Coat of arms of Nigeria",
  },
  // ── 1979 Cold-War roster. Wikimedia thumb paths derived from md5(filename).
  // Seals degrade to the generated NationalSeal if a URL fails, so period-emblem
  // filenames that have since moved fall back cleanly.
  RU: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/State_Emblem_of_the_Soviet_Union.svg/330px-State_Emblem_of_the_Soviet_Union.svg.png",
    alt: "State Emblem of the Soviet Union",
  },
  DD: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Coat_of_arms_of_East_Germany.svg/330px-Coat_of_arms_of_East_Germany.svg.png",
    alt: "Coat of arms of East Germany (GDR)",
  },
  FR: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Armoiries_république_française.svg/330px-Armoiries_république_française.svg.png",
    alt: "Arms of the French Republic",
  },
  IT: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Emblem_of_Italy.svg/330px-Emblem_of_Italy.svg.png",
    alt: "Emblem of Italy",
  },
  ES: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Coat_of_Arms_of_Spain_(1977–1981).svg/330px-Coat_of_Arms_of_Spain_(1977–1981).svg.png",
    alt: "Coat of arms of Spain (1977–1981)",
  },
  SE: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Great_coat_of_arms_of_Sweden.svg/330px-Great_coat_of_arms_of_Sweden.svg.png",
    alt: "Greater coat of arms of Sweden",
  },
  TR: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Emblem_of_Turkey.svg/330px-Emblem_of_Turkey.svg.png",
    alt: "Emblem of Turkey",
  },
  GR: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Coat_of_arms_of_Greece.svg/330px-Coat_of_arms_of_Greece.svg.png",
    alt: "Coat of arms of Greece",
  },
  AT: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Coat_of_arms_of_Austria.svg/330px-Coat_of_arms_of_Austria.svg.png",
    alt: "Coat of arms of Austria (Bundesadler)",
  },
  FI: {
    src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Coat_of_arms_of_Finland.svg/330px-Coat_of_arms_of_Finland.svg.png",
    alt: "Coat of arms of Finland",
  },
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
