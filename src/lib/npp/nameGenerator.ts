/**
 * Name Generator for Non-Player Politicians (NPPs).
 *
 * The default `generateNPPNameAndGender` pool is a US-style multi-ethnic mix
 * (see `FIRST_NAMES_*` and `LAST_NAMES` in nameLists1.ts; per-country pools
 * live in nameLists1.ts / nameLists2.ts / nameLists3.ts). Per-country
 * generators live further down and are routed via `NAME_GENERATORS` inside
 * `generateUniqueNPPNameAndGender`. To add a new country: define a pool +
 * `generate{XX}NameAndGender` function, then register it in NAME_GENERATORS.
 *
 * A country with no entry falls back to the US pool, which is why the registry
 * matters more than it looks: before this file covered them, a French or
 * Russian chamber seeded entirely American names.
 */

import { namesForYear } from "./nameEra";
import {
  FIRST_NAMES_MALE,
  FIRST_NAMES_FEMALE,
  LAST_NAMES,
  JP_SURNAMES,
  JP_GIVEN_NAMES_MALE,
  JP_GIVEN_NAMES_FEMALE,
  CN_SURNAMES,
  CN_GIVEN_NAMES_MALE,
  CN_GIVEN_NAMES_FEMALE,
  UK_SURNAMES,
  UK_FIRST_NAMES_MALE,
  UK_FIRST_NAMES_FEMALE,
} from "./nameLists1";
import {
  DE_SURNAMES,
  DE_FIRST_NAMES_MALE,
  DE_FIRST_NAMES_FEMALE,
  IE_SURNAMES,
  IE_FIRST_NAMES_MALE,
  IE_FIRST_NAMES_FEMALE,
  BR_SURNAMES,
  BR_FIRST_NAMES_MALE,
  BR_FIRST_NAMES_FEMALE,
  NG_SURNAMES,
  NG_FIRST_NAMES_MALE,
  NG_FIRST_NAMES_FEMALE,
} from "./nameLists2";
import {
  FR_SURNAMES,
  FR_FIRST_NAMES_MALE,
  FR_FIRST_NAMES_FEMALE,
  IT_SURNAMES,
  IT_FIRST_NAMES_MALE,
  IT_FIRST_NAMES_FEMALE,
  ES_SURNAMES,
  ES_FIRST_NAMES_MALE,
  ES_FIRST_NAMES_FEMALE,
  SE_SURNAMES,
  SE_FIRST_NAMES_MALE,
  SE_FIRST_NAMES_FEMALE,
  TR_SURNAMES,
  TR_FIRST_NAMES_MALE,
  TR_FIRST_NAMES_FEMALE,
  RU_SURNAMES,
  RU_FIRST_NAMES_MALE,
  RU_FIRST_NAMES_FEMALE,
} from "./nameLists3";
import {
  HU_SURNAMES,
  HU_FIRST_NAMES_MALE,
  HU_FIRST_NAMES_FEMALE,
  PL_SURNAMES,
  PL_FIRST_NAMES_MALE,
  PL_FIRST_NAMES_FEMALE,
  CS_SURNAMES,
  CS_FIRST_NAMES_MALE,
  CS_FIRST_NAMES_FEMALE,
  BG_SURNAMES,
  BG_FIRST_NAMES_MALE,
  BG_FIRST_NAMES_FEMALE,
  RO_SURNAMES,
  RO_FIRST_NAMES_MALE,
  RO_FIRST_NAMES_FEMALE,
  YU_SURNAMES,
  YU_FIRST_NAMES_MALE,
  YU_FIRST_NAMES_FEMALE,
  BLR_SURNAMES,
  BLR_FIRST_NAMES_MALE,
  BLR_FIRST_NAMES_FEMALE,
  BAL_EE_SURNAMES,
  BAL_EE_FIRST_NAMES_MALE,
  BAL_EE_FIRST_NAMES_FEMALE,
  BAL_LV_SURNAMES,
  BAL_LV_FIRST_NAMES_MALE,
  BAL_LV_FIRST_NAMES_FEMALE,
  BAL_LT_SURNAMES,
  BAL_LT_FIRST_NAMES_MALE,
  BAL_LT_FIRST_NAMES_FEMALE,
  RU_UA_SURNAMES,
  RU_UA_FIRST_NAMES_MALE,
  RU_UA_FIRST_NAMES_FEMALE,
  RU_CAUCASUS_SURNAMES,
  RU_CAUCASUS_FIRST_NAMES_MALE,
  RU_CAUCASUS_FIRST_NAMES_FEMALE,
  RU_CENTRAL_ASIA_SURNAMES,
  RU_CENTRAL_ASIA_FIRST_NAMES_MALE,
  RU_CENTRAL_ASIA_FIRST_NAMES_FEMALE,
  DD_FIRST_NAMES_MALE,
  DD_FIRST_NAMES_FEMALE,
} from "./nameLists4";

// Name suffixes (rare but add variety)
const SUFFIXES = ["Jr.", "Sr.", "III", "IV"];
const SUFFIX_PROBABILITY = 0.05; // 5% chance

/**
 * Generate a random NPP name
 * @returns A full name string
 */
export function generateNPPName(): string {
  return generateNPPNameAndGender().name;
}

// ─── JP Name Pools ──────────────────────────────────────────────────────────
// Japanese names use family name first, given name second (Western order for display).
// Common surname + given name combinations for realistic Japanese politician names.

function generateJPNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.4; // ~40% female, reflecting JP political demographics
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const givenNames = isFemale ? JP_GIVEN_NAMES_FEMALE : JP_GIVEN_NAMES_MALE;

  const surname = JP_SURNAMES[Math.floor(Math.random() * JP_SURNAMES.length)];
  const givenName = givenNames[Math.floor(Math.random() * givenNames.length)];

  return { name: `${givenName} ${surname}`, gender };
}

// ─── CN Name Pools ──────────────────────────────────────────────────────────
// Pinyin romanization without tone marks ("Xi" not "Xí") so player-facing
// names stay ASCII-readable. Chinese-language convention places the family
// name first ("Xi Jinping", not "Jinping Xi") and we preserve that in the
// display output to match how CN officials are referenced in English media.

function generateCNNameAndGender(): { name: string; gender: "male" | "female" } {
  // CCP NPC female delegate share hovers ~25% across recent terms; match that
  // rather than the 50/50 default so the seeded chamber reads as plausible.
  const isFemale = Math.random() < 0.25;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const givenNames = isFemale ? CN_GIVEN_NAMES_FEMALE : CN_GIVEN_NAMES_MALE;

  const surname = CN_SURNAMES[Math.floor(Math.random() * CN_SURNAMES.length)];
  const givenName = givenNames[Math.floor(Math.random() * givenNames.length)];

  return { name: `${surname} ${givenName}`, gender };
}

// ─── UK Name Pools ──────────────────────────────────────────────────────────

function generateUKNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.4;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? UK_FIRST_NAMES_FEMALE : UK_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = UK_SURNAMES[Math.floor(Math.random() * UK_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── DE Name Pools ──────────────────────────────────────────────────────────
// German surnames rendered in the standard transliterated form used in
// English-language sources ("Mueller" rather than "Müller") to keep the
// pool ASCII-clean alongside the other countries.

function generateDENameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.35;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? DE_FIRST_NAMES_FEMALE : DE_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = DE_SURNAMES[Math.floor(Math.random() * DE_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── IE Name Pools ──────────────────────────────────────────────────────────
// Irish names rendered in their common English-language form (drop fadas,
// keep O' and Mc prefixes); these are the spellings used in Dáil records.

function generateIENameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.3;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? IE_FIRST_NAMES_FEMALE : IE_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = IE_SURNAMES[Math.floor(Math.random() * IE_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── BR Name Pools ──────────────────────────────────────────────────────────
// Portuguese names without diacritics ("Joao", "Antonio") for ASCII parity
// with the CN pool; matches how BR politicians are often rendered in English
// news copy.

function generateBRNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.3;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? BR_FIRST_NAMES_FEMALE : BR_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = BR_SURNAMES[Math.floor(Math.random() * BR_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── NG Name Pools ──────────────────────────────────────────────────────────
// Nigeria spans Yoruba, Igbo, Hausa-Fulani and other naming traditions; pools
// blend across the major groups so seeded chambers feel pluralistic. Names
// rendered in the standard English orthography used in Nigerian newspapers.

function generateNGNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.25;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? NG_FIRST_NAMES_FEMALE : NG_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = NG_SURNAMES[Math.floor(Math.random() * NG_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── FR Name Pools ──────────────────────────────────────────────────────────

function generateFRNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.38;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? FR_FIRST_NAMES_FEMALE : FR_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = FR_SURNAMES[Math.floor(Math.random() * FR_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── IT Name Pools ──────────────────────────────────────────────────────────

function generateITNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.35;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? IT_FIRST_NAMES_FEMALE : IT_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = IT_SURNAMES[Math.floor(Math.random() * IT_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── ES Name Pools ──────────────────────────────────────────────────────────
// Spanish practice is two surnames (paternal then maternal). Roughly a third
// of the pool gets the double form so chambers read as Spanish without every
// name running long.

const ES_DOUBLE_SURNAME_PROBABILITY = 0.35;

function generateESNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.4;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? ES_FIRST_NAMES_FEMALE : ES_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const paternal = ES_SURNAMES[Math.floor(Math.random() * ES_SURNAMES.length)];

  if (Math.random() < ES_DOUBLE_SURNAME_PROBABILITY) {
    let maternal = paternal;
    // Two identical surnames would read as an error rather than as a name.
    while (maternal === paternal) {
      maternal = ES_SURNAMES[Math.floor(Math.random() * ES_SURNAMES.length)];
    }
    return { name: `${firstName} ${paternal} ${maternal}`, gender };
  }
  return { name: `${firstName} ${paternal}`, gender };
}

// ─── SE Name Pools ──────────────────────────────────────────────────────────

function generateSENameAndGender(): { name: string; gender: "male" | "female" } {
  // The Riksdag has run at or near 45% women since the 1990s — the highest
  // share of any country modelled here.
  const isFemale = Math.random() < 0.45;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? SE_FIRST_NAMES_FEMALE : SE_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = SE_SURNAMES[Math.floor(Math.random() * SE_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── TR Name Pools ──────────────────────────────────────────────────────────

function generateTRNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.17;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? TR_FIRST_NAMES_FEMALE : TR_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = TR_SURNAMES[Math.floor(Math.random() * TR_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── RU Name Pools ──────────────────────────────────────────────────────────

/**
 * Russian surnames inflect for gender: Ivanov → Ivanova, Belsky → Belskaya.
 * Without this a seeded Duma reads as machine output to anyone who speaks the
 * language, so the pool stores the masculine form and derives the feminine one.
 */
export function feminizeRussianSurname(surname: string): string {
  if (/(sky|skiy|ski)$/.test(surname)) return surname.replace(/(sky|skiy|ski)$/, "skaya");
  if (/(ov|ev|yov|in|yn)$/.test(surname)) return `${surname}a`;
  return surname;
}

/**
 * The RU country spans all 17 macro-regions of the Union — Ukraine, Belarus,
 * the Baltics, Transcaucasia, Central Asia, Moldavia — but name generation has
 * no per-region hook (the generator receives only a countryId). So the single
 * RU pool carries a weighted minority share instead, roughly tracking Soviet
 * census demographics. Each draw picks a nationality first so given name and
 * surname always come from the same tradition. Weights sum to 1 with the
 * ethnic-Russian core taking the remainder (~0.59).
 */
const RU_MINORITY_SUB_POOLS = [
  {
    weight: 0.18, // Ukrainian — -enko/-uk surnames do not inflect
    surnames: RU_UA_SURNAMES,
    male: RU_UA_FIRST_NAMES_MALE,
    female: RU_UA_FIRST_NAMES_FEMALE,
    feminize: feminizeRussianSurname,
  },
  {
    weight: 0.06, // Transcaucasia — Georgian/Armenian forms pass through, Azeri -ov inflects
    surnames: RU_CAUCASUS_SURNAMES,
    male: RU_CAUCASUS_FIRST_NAMES_MALE,
    female: RU_CAUCASUS_FIRST_NAMES_FEMALE,
    feminize: feminizeRussianSurname,
  },
  {
    weight: 0.05, // Central Asia — russified -ov/-ev forms inflect the Russian way
    surnames: RU_CENTRAL_ASIA_SURNAMES,
    male: RU_CENTRAL_ASIA_FIRST_NAMES_MALE,
    female: RU_CENTRAL_ASIA_FIRST_NAMES_FEMALE,
    feminize: feminizeRussianSurname,
  },
  {
    weight: 0.05, // Belarusian — reuses the BLR country pool
    surnames: BLR_SURNAMES,
    male: BLR_FIRST_NAMES_MALE,
    female: BLR_FIRST_NAMES_FEMALE,
    feminize: feminizeRussianSurname,
  },
  {
    weight: 0.03, // Baltic (Lithuanian share, the largest of the three)
    surnames: BAL_LT_SURNAMES,
    male: BAL_LT_FIRST_NAMES_MALE,
    female: BAL_LT_FIRST_NAMES_FEMALE,
    feminize: feminizeLithuanianSurname,
  },
  {
    weight: 0.02, // Baltic (Latvian share)
    surnames: BAL_LV_SURNAMES,
    male: BAL_LV_FIRST_NAMES_MALE,
    female: BAL_LV_FIRST_NAMES_FEMALE,
    feminize: feminizeLatvianSurname,
  },
  {
    weight: 0.02, // Moldavian — Romanian names, reuses the RO country pool
    surnames: RO_SURNAMES,
    male: RO_FIRST_NAMES_MALE,
    female: RO_FIRST_NAMES_FEMALE,
    feminize: (surname: string) => surname,
  },
] as const;

const RU_MINORITY_SHARE = RU_MINORITY_SUB_POOLS.reduce((sum, pool) => sum + pool.weight, 0);

function generateRUNameAndGender(): { name: string; gender: "male" | "female" } {
  // Supreme Soviet / Duma women's representation has sat near 16-30% across
  // the modelled eras; 16% keeps the pre-existing behaviour.
  const isFemale = Math.random() < 0.16;
  const gender: "male" | "female" = isFemale ? "female" : "male";

  if (Math.random() < RU_MINORITY_SHARE) {
    // Rescale the roll into the minority share so sub-weights hold.
    const sub = pickWeighted(
      RU_MINORITY_SUB_POOLS.map((pool) => ({ ...pool, weight: pool.weight / RU_MINORITY_SHARE }))
    );
    const firstNames = isFemale ? sub.female : sub.male;
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const surname = sub.surnames[Math.floor(Math.random() * sub.surnames.length)];
    return { name: `${firstName} ${isFemale ? sub.feminize(surname) : surname}`, gender };
  }

  const firstNames = isFemale ? RU_FIRST_NAMES_FEMALE : RU_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = RU_SURNAMES[Math.floor(Math.random() * RU_SURNAMES.length)];
  return {
    name: `${firstName} ${isFemale ? feminizeRussianSurname(surname) : surname}`,
    gender,
  };
}

// ─── Eastern-bloc feminizers ────────────────────────────────────────────────
// Same rationale as feminizeRussianSurname: these languages inflect surnames
// for gender, and a chamber where the women carry masculine forms reads as
// machine output. Pools store the masculine form; the feminine one is derived.

/** Polish adjectival surnames: Kowalski → Kowalska, Zawadzki → Zawadzka. */
export function feminizePolishSurname(surname: string): string {
  if (/(ski|cki|dzki)$/.test(surname)) return surname.replace(/ki$/, "ka");
  // Non-adjectival Polish surnames (Nowak, Mazur, Wilk) do not inflect.
  return surname;
}

/** Czech/Slovak surnames: Novak → Novakova, Svoboda → Svobodova, Novotny → Novotna. */
export function feminizeCzechSurname(surname: string): string {
  if (/y$/.test(surname)) return surname.replace(/y$/, "a"); // adjectival: Cerny → Cerna
  if (/a$/.test(surname)) return `${surname.slice(0, -1)}ova`; // Svoboda → Svobodova
  return `${surname}ova`;
}

/** Latvian surnames: Berzins → Berzina, Balodis → Balode, Ozols → Ozola. */
export function feminizeLatvianSurname(surname: string): string {
  if (/ins$/.test(surname)) return surname.replace(/s$/, "a");
  if (/is$/.test(surname)) return surname.replace(/is$/, "e");
  if (/s$/.test(surname)) return surname.replace(/s$/, "a");
  return surname; // vowel-final forms (Priede, Roze) serve both genders
}

/** Lithuanian surnames, married form: Kazlauskas → Kazlauskiene, Butkus → Butkiene. */
export function feminizeLithuanianSurname(surname: string): string {
  if (/(as|is|ys|us)$/.test(surname)) return `${surname.replace(/(as|is|ys|us)$/, "")}iene`;
  return surname;
}

// ─── HU Name Pools ──────────────────────────────────────────────────────────
// Hungarian is the one European language written family-name-first
// ("Nagy Istvan"), so HU shares the CN surnameFirst mechanism.

function generateHUNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.22;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const givenNames = isFemale ? HU_FIRST_NAMES_FEMALE : HU_FIRST_NAMES_MALE;
  const surname = HU_SURNAMES[Math.floor(Math.random() * HU_SURNAMES.length)];
  const givenName = givenNames[Math.floor(Math.random() * givenNames.length)];
  return { name: `${surname} ${givenName}`, gender };
}

// ─── PL Name Pools ──────────────────────────────────────────────────────────

function generatePLNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.23;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? PL_FIRST_NAMES_FEMALE : PL_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = PL_SURNAMES[Math.floor(Math.random() * PL_SURNAMES.length)];
  return { name: `${firstName} ${isFemale ? feminizePolishSurname(surname) : surname}`, gender };
}

// ─── CS Name Pools ──────────────────────────────────────────────────────────

function generateCSNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.28;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? CS_FIRST_NAMES_FEMALE : CS_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = CS_SURNAMES[Math.floor(Math.random() * CS_SURNAMES.length)];
  return { name: `${firstName} ${isFemale ? feminizeCzechSurname(surname) : surname}`, gender };
}

// ─── BG Name Pools ──────────────────────────────────────────────────────────
// The BG surname pool is all -ov/-ev, which the Russian feminizer inflects
// correctly for Bulgarian too (Dimitrov → Dimitrova).

function generateBGNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.21;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? BG_FIRST_NAMES_FEMALE : BG_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = BG_SURNAMES[Math.floor(Math.random() * BG_SURNAMES.length)];
  return { name: `${firstName} ${isFemale ? feminizeRussianSurname(surname) : surname}`, gender };
}

// ─── RO Name Pools ──────────────────────────────────────────────────────────
// Romanian surnames do not inflect for gender. Female share runs high for the
// bloc: Romania pushed one of the largest legislature quotas by the 1980s.

function generateRONameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.32;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? RO_FIRST_NAMES_FEMALE : RO_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = RO_SURNAMES[Math.floor(Math.random() * RO_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── YU Name Pools ──────────────────────────────────────────────────────────
// Pan-Yugoslav pool; the -ic patronymics do not inflect for gender.

function generateYUNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.18;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? YU_FIRST_NAMES_FEMALE : YU_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = YU_SURNAMES[Math.floor(Math.random() * YU_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

// ─── BLR Name Pools ─────────────────────────────────────────────────────────
// Patronymic -vich and nature surnames pass through the Russian feminizer
// unchanged (correctly); the russified -ov/-sky share inflects.

function generateBLRNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.3;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? BLR_FIRST_NAMES_FEMALE : BLR_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = BLR_SURNAMES[Math.floor(Math.random() * BLR_SURNAMES.length)];
  return { name: `${firstName} ${isFemale ? feminizeRussianSurname(surname) : surname}`, gender };
}

// ─── BAL Name Pools ─────────────────────────────────────────────────────────
// BAL is a composite macro-country, so a nationality is drawn first and both
// name parts come from the same tradition — no "Vytautas Tamm" hybrids.
// Weights follow the three republics' populations (LT largest).

const BAL_SUB_POOLS = [
  {
    weight: 0.42, // Lithuania
    surnames: BAL_LT_SURNAMES,
    male: BAL_LT_FIRST_NAMES_MALE,
    female: BAL_LT_FIRST_NAMES_FEMALE,
    feminize: feminizeLithuanianSurname,
  },
  {
    weight: 0.33, // Latvia
    surnames: BAL_LV_SURNAMES,
    male: BAL_LV_FIRST_NAMES_MALE,
    female: BAL_LV_FIRST_NAMES_FEMALE,
    feminize: feminizeLatvianSurname,
  },
  {
    weight: 0.25, // Estonia — surnames do not inflect
    surnames: BAL_EE_SURNAMES,
    male: BAL_EE_FIRST_NAMES_MALE,
    female: BAL_EE_FIRST_NAMES_FEMALE,
    feminize: (surname: string) => surname,
  },
] as const;

function pickWeighted<T extends { weight: number }>(pools: readonly T[]): T {
  let roll = Math.random();
  for (const pool of pools) {
    roll -= pool.weight;
    if (roll < 0) return pool;
  }
  return pools[pools.length - 1];
}

function generateBALNameAndGender(): { name: string; gender: "male" | "female" } {
  const sub = pickWeighted(BAL_SUB_POOLS);
  const isFemale = Math.random() < 0.3;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? sub.female : sub.male;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = sub.surnames[Math.floor(Math.random() * sub.surnames.length)];
  return { name: `${firstName} ${isFemale ? sub.feminize(surname) : surname}`, gender };
}

// ─── DD Name Pools ──────────────────────────────────────────────────────────
// Surnames are German either side of the wall, so DD reuses DE_SURNAMES; the
// first names come from the GDR-era cohorts instead of the era-neutral DE
// lists, so a Volkskammer bench reads 1950s-1980s rather than 2019.

function generateDDNameAndGender(): { name: string; gender: "male" | "female" } {
  const isFemale = Math.random() < 0.3; // Volkskammer quota ran near a third
  const gender: "male" | "female" = isFemale ? "female" : "male";
  const firstNames = isFemale ? DD_FIRST_NAMES_FEMALE : DD_FIRST_NAMES_MALE;
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const surname = DE_SURNAMES[Math.floor(Math.random() * DE_SURNAMES.length)];
  return { name: `${firstName} ${surname}`, gender };
}

/**
 * Generate a random NPP name along with the gender used to produce it.
 * Use this when the gender is needed for downstream logic (e.g. image selection).
 */
export function generateNPPNameAndGender(year?: number | null): {
  name: string;
  gender: "male" | "female";
} {
  const isFemale = Math.random() < 0.5;
  const gender: "male" | "female" = isFemale ? "female" : "male";
  // Era gate: a 1953 senator should not be called Aaliyah. Only demonstrably
  // modern names are excluded — see `nameEra.ts`. Surnames are untouched: they
  // are inherited, not chosen, so they do not date a character.
  const firstNames = namesForYear(isFemale ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE, year);

  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];

  // Small chance for suffix (mostly male)
  let suffix = "";
  if (!isFemale && Math.random() < SUFFIX_PROBABILITY) {
    suffix = " " + SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
  }

  return { name: `${firstName} ${lastName}${suffix}`, gender };
}

/**
 * Generate multiple unique NPP names
 * @param count Number of names to generate
 * @returns Array of unique name strings
 */
export function generateNPPNames(count: number): string[] {
  const names = new Set<string>();
  let attempts = 0;
  const maxAttempts = count * 10; // Prevent infinite loops

  while (names.size < count && attempts < maxAttempts) {
    names.add(generateNPPName());
    attempts++;
  }

  return Array.from(names);
}

/**
 * Check if a name is already used (for collision detection)
 * This is a utility for when we need to ensure uniqueness against existing NPPs
 */
export function isNameUnique(name: string, existingNames: string[]): boolean {
  const normalized = name.toLowerCase().trim();
  return !existingNames.some((existing) => existing.toLowerCase().trim() === normalized);
}

/**
 * Generate a unique name not in the existing list
 * @param existingNames List of names that already exist
 * @param maxAttempts Maximum generation attempts
 * @returns A unique name or null if unable to generate
 */
export function generateUniqueNPPName(
  existingNames: string[],
  maxAttempts = 100,
  countryId?: string
): string | null {
  const result = generateUniqueNPPNameAndGender(existingNames, maxAttempts, countryId);
  return result ? result.name : null;
}

/**
 * The token pools behind each country's generator, indexed for membership
 * checks. `isNameFromCountryPool` uses this to tell a name that came out of
 * the right pool from one that came out of the US fallback — which is what an
 * NPP seeded before its country had a pool looks like.
 *
 * Countries absent here have no pool of their own and legitimately use the US
 * one, so nothing about their names can be wrong.
 */
const COUNTRY_NAME_POOLS: Record<
  string,
  { surnames: readonly string[]; firstNames: readonly string[]; surnameFirst?: boolean }
> = {
  UK: { surnames: UK_SURNAMES, firstNames: [...UK_FIRST_NAMES_MALE, ...UK_FIRST_NAMES_FEMALE] },
  DE: { surnames: DE_SURNAMES, firstNames: [...DE_FIRST_NAMES_MALE, ...DE_FIRST_NAMES_FEMALE] },
  // DD keeps the DE first names in its membership pool so NPPs seeded under
  // the old DE alias still pass the heal check; the generator itself only
  // emits the GDR-era first names.
  DD: {
    surnames: DE_SURNAMES,
    firstNames: [
      ...DD_FIRST_NAMES_MALE,
      ...DD_FIRST_NAMES_FEMALE,
      ...DE_FIRST_NAMES_MALE,
      ...DE_FIRST_NAMES_FEMALE,
    ],
  },
  IE: { surnames: IE_SURNAMES, firstNames: [...IE_FIRST_NAMES_MALE, ...IE_FIRST_NAMES_FEMALE] },
  BR: { surnames: BR_SURNAMES, firstNames: [...BR_FIRST_NAMES_MALE, ...BR_FIRST_NAMES_FEMALE] },
  NG: { surnames: NG_SURNAMES, firstNames: [...NG_FIRST_NAMES_MALE, ...NG_FIRST_NAMES_FEMALE] },
  FR: { surnames: FR_SURNAMES, firstNames: [...FR_FIRST_NAMES_MALE, ...FR_FIRST_NAMES_FEMALE] },
  IT: { surnames: IT_SURNAMES, firstNames: [...IT_FIRST_NAMES_MALE, ...IT_FIRST_NAMES_FEMALE] },
  ES: { surnames: ES_SURNAMES, firstNames: [...ES_FIRST_NAMES_MALE, ...ES_FIRST_NAMES_FEMALE] },
  SE: { surnames: SE_SURNAMES, firstNames: [...SE_FIRST_NAMES_MALE, ...SE_FIRST_NAMES_FEMALE] },
  TR: { surnames: TR_SURNAMES, firstNames: [...TR_FIRST_NAMES_MALE, ...TR_FIRST_NAMES_FEMALE] },
  // RU membership spans the whole minority-broadened pool; Baltic feminine
  // forms are stored explicitly because their feminizers are not the Russian
  // one that isNameFromCountryPool derives with.
  RU: {
    surnames: [
      ...RU_SURNAMES,
      ...RU_UA_SURNAMES,
      ...RU_CAUCASUS_SURNAMES,
      ...RU_CENTRAL_ASIA_SURNAMES,
      ...BLR_SURNAMES,
      ...BAL_LT_SURNAMES,
      ...BAL_LT_SURNAMES.map(feminizeLithuanianSurname),
      ...BAL_LV_SURNAMES,
      ...BAL_LV_SURNAMES.map(feminizeLatvianSurname),
      ...RO_SURNAMES,
    ],
    firstNames: [
      ...RU_FIRST_NAMES_MALE,
      ...RU_FIRST_NAMES_FEMALE,
      ...RU_UA_FIRST_NAMES_MALE,
      ...RU_UA_FIRST_NAMES_FEMALE,
      ...RU_CAUCASUS_FIRST_NAMES_MALE,
      ...RU_CAUCASUS_FIRST_NAMES_FEMALE,
      ...RU_CENTRAL_ASIA_FIRST_NAMES_MALE,
      ...RU_CENTRAL_ASIA_FIRST_NAMES_FEMALE,
      ...BLR_FIRST_NAMES_MALE,
      ...BLR_FIRST_NAMES_FEMALE,
      ...BAL_LT_FIRST_NAMES_MALE,
      ...BAL_LT_FIRST_NAMES_FEMALE,
      ...BAL_LV_FIRST_NAMES_MALE,
      ...BAL_LV_FIRST_NAMES_FEMALE,
      ...RO_FIRST_NAMES_MALE,
      ...RO_FIRST_NAMES_FEMALE,
    ],
  },
  HU: {
    surnames: HU_SURNAMES,
    firstNames: [...HU_FIRST_NAMES_MALE, ...HU_FIRST_NAMES_FEMALE],
    surnameFirst: true,
  },
  // Feminine surname forms are derived by language-specific feminizers, so
  // the membership pools below store both forms where they differ.
  PL: {
    surnames: [...PL_SURNAMES, ...PL_SURNAMES.map(feminizePolishSurname)],
    firstNames: [...PL_FIRST_NAMES_MALE, ...PL_FIRST_NAMES_FEMALE],
  },
  CS: {
    surnames: [...CS_SURNAMES, ...CS_SURNAMES.map(feminizeCzechSurname)],
    firstNames: [...CS_FIRST_NAMES_MALE, ...CS_FIRST_NAMES_FEMALE],
  },
  BG: { surnames: BG_SURNAMES, firstNames: [...BG_FIRST_NAMES_MALE, ...BG_FIRST_NAMES_FEMALE] },
  RO: { surnames: RO_SURNAMES, firstNames: [...RO_FIRST_NAMES_MALE, ...RO_FIRST_NAMES_FEMALE] },
  YU: { surnames: YU_SURNAMES, firstNames: [...YU_FIRST_NAMES_MALE, ...YU_FIRST_NAMES_FEMALE] },
  BLR: {
    surnames: BLR_SURNAMES,
    firstNames: [...BLR_FIRST_NAMES_MALE, ...BLR_FIRST_NAMES_FEMALE],
  },
  BAL: {
    surnames: [
      ...BAL_EE_SURNAMES,
      ...BAL_LV_SURNAMES,
      ...BAL_LV_SURNAMES.map(feminizeLatvianSurname),
      ...BAL_LT_SURNAMES,
      ...BAL_LT_SURNAMES.map(feminizeLithuanianSurname),
    ],
    firstNames: [
      ...BAL_EE_FIRST_NAMES_MALE,
      ...BAL_EE_FIRST_NAMES_FEMALE,
      ...BAL_LV_FIRST_NAMES_MALE,
      ...BAL_LV_FIRST_NAMES_FEMALE,
      ...BAL_LT_FIRST_NAMES_MALE,
      ...BAL_LT_FIRST_NAMES_FEMALE,
    ],
  },
  SCO: { surnames: UK_SURNAMES, firstNames: [...UK_FIRST_NAMES_MALE, ...UK_FIRST_NAMES_FEMALE] },
  WAL: { surnames: UK_SURNAMES, firstNames: [...UK_FIRST_NAMES_MALE, ...UK_FIRST_NAMES_FEMALE] },
  JP: {
    surnames: JP_SURNAMES,
    firstNames: [...JP_GIVEN_NAMES_MALE, ...JP_GIVEN_NAMES_FEMALE],
  },
  CN: {
    surnames: CN_SURNAMES,
    firstNames: [...CN_GIVEN_NAMES_MALE, ...CN_GIVEN_NAMES_FEMALE],
    surnameFirst: true,
  },
};

/**
 * True when `name` could have been produced by `countryId`'s own pool.
 *
 * Used by the NPP name heal to find politicians seeded before their country
 * had a pool — an Italian deputy called "Carmen Washington" fails this, an
 * Italian deputy called "Carmela Russo" passes it. Countries with no pool of
 * their own always pass: the US pool is their correct pool.
 */
export function isNameFromCountryPool(name: string, countryId?: string): boolean {
  const pool = countryId ? COUNTRY_NAME_POOLS[countryId.toUpperCase()] : undefined;
  if (!pool) return true;

  const tokens = name
    .trim()
    .split(/\s+/)
    .filter((token) => !SUFFIXES.includes(token));
  if (tokens.length < 2) return false;

  const given = pool.surnameFirst ? tokens.slice(1) : tokens.slice(0, 1);
  // Spanish names carry two surnames, so every trailing token is a candidate.
  const family = pool.surnameFirst ? tokens.slice(0, 1) : tokens.slice(1);

  const surnames = new Set(pool.surnames);
  const firstNames = new Set(pool.firstNames);

  const matchesSurname = (candidate: string): boolean =>
    surnames.has(candidate) ||
    // Russian feminine forms are derived, not stored.
    pool.surnames.some((surname) => feminizeRussianSurname(surname) === candidate);

  // Surnames are not always one token. The Italian pool stores "De Luca" and
  // "De Santis", so checking token by token asked whether "De" and "Luca" were
  // surnames, found neither, and declared a name the generator had just
  // produced to be foreign. That made ~3% of Italian NPPs permanently fail
  // their own pool, and since the NPP name heal uses this predicate to decide
  // who needs renaming, it would rename them on every run — to another name
  // that could be compound again. Every contiguous run of the family tokens is
  // a candidate, so a stored surname of any length matches.
  const familyMatches = family.some((_, start) =>
    family.slice(start).some((__, end) => matchesSurname(family.slice(start, start + end + 1).join(" ")))
  );
  return familyMatches && given.some((token) => firstNames.has(token));
}

/** Given-name lists per gender across every pool, for gender inference. */
const ALL_MALE_GIVEN_NAMES: readonly string[] = [
  ...FIRST_NAMES_MALE,
  ...UK_FIRST_NAMES_MALE,
  ...DE_FIRST_NAMES_MALE,
  ...IE_FIRST_NAMES_MALE,
  ...BR_FIRST_NAMES_MALE,
  ...NG_FIRST_NAMES_MALE,
  ...FR_FIRST_NAMES_MALE,
  ...IT_FIRST_NAMES_MALE,
  ...ES_FIRST_NAMES_MALE,
  ...SE_FIRST_NAMES_MALE,
  ...TR_FIRST_NAMES_MALE,
  ...RU_FIRST_NAMES_MALE,
  ...JP_GIVEN_NAMES_MALE,
  ...CN_GIVEN_NAMES_MALE,
  ...HU_FIRST_NAMES_MALE,
  ...PL_FIRST_NAMES_MALE,
  ...CS_FIRST_NAMES_MALE,
  ...BG_FIRST_NAMES_MALE,
  ...RO_FIRST_NAMES_MALE,
  ...YU_FIRST_NAMES_MALE,
  ...BLR_FIRST_NAMES_MALE,
  ...BAL_EE_FIRST_NAMES_MALE,
  ...BAL_LV_FIRST_NAMES_MALE,
  ...BAL_LT_FIRST_NAMES_MALE,
  ...RU_UA_FIRST_NAMES_MALE,
  ...RU_CAUCASUS_FIRST_NAMES_MALE,
  ...RU_CENTRAL_ASIA_FIRST_NAMES_MALE,
  ...DD_FIRST_NAMES_MALE,
];

const ALL_FEMALE_GIVEN_NAMES: readonly string[] = [
  ...FIRST_NAMES_FEMALE,
  ...UK_FIRST_NAMES_FEMALE,
  ...DE_FIRST_NAMES_FEMALE,
  ...IE_FIRST_NAMES_FEMALE,
  ...BR_FIRST_NAMES_FEMALE,
  ...NG_FIRST_NAMES_FEMALE,
  ...FR_FIRST_NAMES_FEMALE,
  ...IT_FIRST_NAMES_FEMALE,
  ...ES_FIRST_NAMES_FEMALE,
  ...SE_FIRST_NAMES_FEMALE,
  ...TR_FIRST_NAMES_FEMALE,
  ...RU_FIRST_NAMES_FEMALE,
  ...JP_GIVEN_NAMES_FEMALE,
  ...CN_GIVEN_NAMES_FEMALE,
  ...HU_FIRST_NAMES_FEMALE,
  ...PL_FIRST_NAMES_FEMALE,
  ...CS_FIRST_NAMES_FEMALE,
  ...BG_FIRST_NAMES_FEMALE,
  ...RO_FIRST_NAMES_FEMALE,
  ...YU_FIRST_NAMES_FEMALE,
  ...BLR_FIRST_NAMES_FEMALE,
  ...BAL_EE_FIRST_NAMES_FEMALE,
  ...BAL_LV_FIRST_NAMES_FEMALE,
  ...BAL_LT_FIRST_NAMES_FEMALE,
  ...RU_UA_FIRST_NAMES_FEMALE,
  ...RU_CAUCASUS_FIRST_NAMES_FEMALE,
  ...RU_CENTRAL_ASIA_FIRST_NAMES_FEMALE,
  ...DD_FIRST_NAMES_FEMALE,
];

/**
 * Infer gender from an NPP's given name.
 *
 * The US lists are checked first so existing US/UK behaviour is unchanged, then
 * every other pool — without that second pass a French or Swedish NPP got a
 * coin flip, and a coin flip is how a portrait ends up disagreeing with a name.
 * Pass `countryId` for countries written surname-first (CN), where the given
 * name is not the first token.
 *
 * Falls back to a 50/50 assignment for names in no list, or in both.
 */
export function inferGenderFromFirstName(fullName: string, countryId?: string): "male" | "female" {
  const pool = countryId ? COUNTRY_NAME_POOLS[countryId.toUpperCase()] : undefined;
  const tokens = fullName.trim().split(/\s+/);
  const givenName = (pool?.surnameFirst ? tokens[1] : tokens[0]) ?? "";

  if (FIRST_NAMES_FEMALE.includes(givenName)) return "female";
  if (FIRST_NAMES_MALE.includes(givenName)) return "male";

  const isFemale = ALL_FEMALE_GIVEN_NAMES.includes(givenName);
  const isMale = ALL_MALE_GIVEN_NAMES.includes(givenName);
  // Some given names are male in one country and female in another (Andrea is
  // male in Italy, female in Germany). Ambiguous means unknown, not male.
  if (isFemale && !isMale) return "female";
  if (isMale && !isFemale) return "male";

  return Math.random() < 0.5 ? "female" : "male";
}

/**
 * Generate a unique name along with its gender.
 * Prefer this over generateUniqueNPPName when gender is needed downstream.
 */
export function generateUniqueNPPNameAndGender(
  existingNames: string[],
  maxAttempts = 100,
  countryId?: string,
  /** Live in-game year; gates demonstrably modern given names. */
  year?: number | null
): { name: string; gender: "male" | "female" } | null {
  const NAME_GENERATORS: Record<string, typeof generateNPPNameAndGender> = {
    // The default `generateNPPNameAndGender` is a US-style multi-ethnic pool,
    // so US is registered explicitly here for clarity even though it would hit
    // the same generator via the fallback below.
    US: generateNPPNameAndGender,
    UK: generateUKNameAndGender,
    DE: generateDENameAndGender,
    JP: generateJPNameAndGender,
    CN: generateCNNameAndGender,
    IE: generateIENameAndGender,
    BR: generateBRNameAndGender,
    NG: generateNGNameAndGender,
    FR: generateFRNameAndGender,
    IT: generateITNameAndGender,
    ES: generateESNameAndGender,
    SE: generateSENameAndGender,
    TR: generateTRNameAndGender,
    RU: generateRUNameAndGender,
    HU: generateHUNameAndGender,
    PL: generatePLNameAndGender,
    CS: generateCSNameAndGender,
    BG: generateBGNameAndGender,
    RO: generateRONameAndGender,
    YU: generateYUNameAndGender,
    BLR: generateBLRNameAndGender,
    BAL: generateBALNameAndGender,
    // East Germany: German surnames (shared DE pool — the split is political,
    // not onomastic) but GDR-era first names, not the era-neutral DE lists.
    DD: generateDDNameAndGender,
    // Latent secession targets — British Isles naming, same as the UK pool.
    SCO: generateUKNameAndGender,
    WAL: generateUKNameAndGender,
  };
  const generator =
    (countryId ? NAME_GENERATORS[countryId.toUpperCase()] : undefined) ?? generateNPPNameAndGender;
  for (let i = 0; i < maxAttempts; i++) {
    // Only the US generator takes a year today; the others ignore the extra
    // argument harmlessly, so this needs no per-country branching.
    const result = generator(year);
    if (isNameUnique(result.name, existingNames)) {
      return result;
    }
  }
  return null;
}
