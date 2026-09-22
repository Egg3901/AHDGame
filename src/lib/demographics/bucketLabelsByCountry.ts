import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";
import { UK_BUCKET_LABELS } from "@/lib/countries/uk/data/ukBucketLabels";
import { IE_BUCKET_LABELS } from "@/lib/countries/ie/data/ieBucketLabels";
import { NG_BUCKET_LABELS } from "@/lib/countries/ng/data/ngBucketLabels";
import { DE_BUCKET_LABELS } from "@/lib/countries/de/data/deBucketLabels";
import { DD_BUCKET_LABELS } from "@/lib/countries/dd/data/ddBucketLabels";
import { AT_BUCKET_LABELS } from "@/lib/countries/at/data/atBucketLabels";
import { BR_BUCKET_LABELS } from "@/lib/countries/br/data/brBucketLabels";
import { FR_BUCKET_LABELS } from "@/lib/countries/fr/data/frBucketLabels";
import { IT_BUCKET_LABELS } from "@/lib/countries/it/data/itBucketLabels";
import { ES_BUCKET_LABELS } from "@/lib/countries/es/data/esBucketLabels";
import { SE_BUCKET_LABELS } from "@/lib/countries/se/data/seBucketLabels";
import { FI_BUCKET_LABELS } from "@/lib/countries/fi/data/fiBucketLabels";
import { TR_BUCKET_LABELS } from "@/lib/countries/tr/data/trBucketLabels";
import { JP_BUCKET_LABELS } from "@/lib/countries/jp/data/jpBucketLabels";
import { CN_BUCKET_LABELS } from "@/lib/countries/cn/data/cnBucketLabels";
import { RU_BUCKET_LABELS } from "@/lib/countries/ru/data/ruBucketLabels";
import { GR_BUCKET_LABELS } from "@/lib/countries/gr/data/grBucketLabels";
import { HU_BUCKET_LABELS } from "@/lib/countries/hu/data/huBucketLabels";
import { PL_BUCKET_LABELS } from "@/lib/countries/pl/data/plBucketLabels";
import { RO_BUCKET_LABELS } from "@/lib/countries/ro/data/roBucketLabels";
import { YU_BUCKET_LABELS } from "@/lib/countries/yu/data/yuBucketLabels";
import { CS_BUCKET_LABELS } from "@/lib/countries/cs/data/csBucketLabels";
import { BAL_BUCKET_LABELS } from "@/lib/countries/bal/data/balBucketLabels";
import { BG_BUCKET_LABELS } from "@/lib/countries/bg/data/bgBucketLabels";
import { UKR_BUCKET_LABELS } from "@/lib/countries/ukr/data/ukrBucketLabels";
import { BLR_BUCKET_LABELS } from "@/lib/countries/blr/data/blrBucketLabels";
import { SCO_BUCKET_LABELS } from "@/lib/countries/sco/data/scoBucketLabels";
import { WAL_BUCKET_LABELS } from "@/lib/countries/wal/data/walBucketLabels";
/**
 * Player-facing bucket names, in each country's own language.
 *
 * The Layer-1 bucket keys are internal and English-ish (`no_qualifications`,
 * `berufsausbildung`, `branco`). Humanising them gave "No Qualifications" and
 * "Branco" — neither the country's real term nor consistent copy. These are the
 * terms those electorates actually use for themselves.
 *
 * SCRIPT RULE
 * -----------
 * Latin-script languages get the native term alone: a player reading a German
 * world sees "Hochschulabschluss", which is both authentic and legible.
 * Non-Latin scripts (JP, CN, RU, GR) get the native term followed by an English
 * gloss — "大学卒 (University)" — because a picker nobody can read is not a
 * feature, and the targeting UI has to stay usable for every player regardless
 * of the world they are in.
 *
 * A country absent from this table falls back to the US labels and then to a
 * humanised key, so a new seed renders unpolished rather than blank.
 */

/** Age bands are the same four keys everywhere; only the words change. */

export type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";

export const COUNTRY_BUCKET_LABELS: Record<string, CountryBucketLabels> = {
  UK: UK_BUCKET_LABELS,
  IE: IE_BUCKET_LABELS,
  NG: NG_BUCKET_LABELS,
  DE: DE_BUCKET_LABELS,
  DD: DD_BUCKET_LABELS,
  AT: AT_BUCKET_LABELS,
  BR: BR_BUCKET_LABELS,
  FR: FR_BUCKET_LABELS,
  IT: IT_BUCKET_LABELS,
  ES: ES_BUCKET_LABELS,
  SE: SE_BUCKET_LABELS,
  FI: FI_BUCKET_LABELS,
  TR: TR_BUCKET_LABELS,
  JP: JP_BUCKET_LABELS,
  CN: CN_BUCKET_LABELS,
  RU: RU_BUCKET_LABELS,
  GR: GR_BUCKET_LABELS,
  HU: HU_BUCKET_LABELS,
  PL: PL_BUCKET_LABELS,
  RO: RO_BUCKET_LABELS,
  YU: YU_BUCKET_LABELS,
  CS: CS_BUCKET_LABELS,
  BAL: BAL_BUCKET_LABELS,
  BG: BG_BUCKET_LABELS,
  UKR: UKR_BUCKET_LABELS,
  BLR: BLR_BUCKET_LABELS,
  SCO: SCO_BUCKET_LABELS,
  WAL: WAL_BUCKET_LABELS,
};

/** Countries whose labels carry an English gloss because the script is not Latin. */
export const GLOSSED_COUNTRIES = new Set(["JP", "CN", "RU", "GR", "BG", "UKR", "BLR"]);
