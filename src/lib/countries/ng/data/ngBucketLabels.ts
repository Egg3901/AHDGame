import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";
import { AGE_EN, DIMS_EN, INCOME_EN } from "@/lib/demographics/bucketLabelScaffolding";

// English is Nigeria's official language, so no gloss is needed. Faith is a
// real dimension here and no other country has it.
export const NG_BUCKET_LABELS: CountryBucketLabels = {
  dims: { ...DIMS_EN, religion: "Faith" },
  buckets: {
    religion: {
      muslim: "Muslims",
      christian: "Christians",
      other: "Traditional and other faiths",
    },
    ethnicity: {
      hausa_fulani: "Hausa-Fulani",
      yoruba: "Yoruba",
      igbo: "Igbo",
      minority: "Minority groups",
    },
    age: AGE_EN,
    education: {
      basic: "Basic education",
      secondary: "Secondary school",
      tertiary: "Tertiary education",
    },
    income: INCOME_EN,
    urbanization: { urban: "Cities", suburban: "Peri-urban", rural: "Rural" },
  },
};
