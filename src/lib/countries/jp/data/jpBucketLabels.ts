import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelsByCountry";

/**
 * Japanese-language labels for the Layer-1 census buckets.
 *
 * Moved out of `src/lib/demographics/bucketLabelsByCountry.ts`, which now
 * forwards to this. Text unchanged.
 *
 * ⚠ NATIVE TERM PLUS AN ENGLISH GLOSS, and both halves are load-bearing.
 * Japan is in `GLOSSED_COUNTRIES` (still declared in the registry module, since
 * it names seven countries and is not Japan's to own), which is what tells the
 * UI these labels already carry their own translation. Stripping the gloss to
 * "tidy up" leaves English-reading players with an unreadable axis.
 */
export const JP_BUCKET_LABELS: CountryBucketLabels = {
  dims: {
    ethnicity: "出身 (Background)",
    age: "年齢 (Age)",
    education: "学歴 (Education)",
    income: "所得 (Income)",
    urbanization: "居住地 (Where they live)",
  },
  buckets: {
    ethnicity: {
      japanese: "日本人 (Japanese)",
      chinese: "中国系 (Chinese)",
      korean: "韓国・朝鮮系 (Korean)",
      southeast_asian: "東南アジア系 (Southeast Asian)",
      other_foreign: "その他の外国系 (Other foreign)",
    },
    age: {
      young: "30歳未満 (Under 30)",
      mid: "30〜49歳 (30s and 40s)",
      mature: "50〜64歳 (50s and 60s)",
      senior: "65歳以上 (Over 65)",
    },
    education: {
      primary_or_below: "小学校卒以下 (Primary or below)",
      high_school: "高校卒 (High school)",
      vocational: "専門学校卒 (Vocational)",
      university: "大学卒 (University)",
      graduate: "大学院卒 (Graduate)",
    },
    income: {
      low: "低所得 (Lower income)",
      middle: "中所得 (Middle income)",
      high: "高所得 (Higher income)",
    },
    urbanization: {
      urban: "都市部 (Cities)",
      suburban: "郊外 (Suburbs)",
      rural: "地方 (Rural)",
    },
  },
};
