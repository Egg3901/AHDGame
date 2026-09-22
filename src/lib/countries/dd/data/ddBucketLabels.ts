import type { CountryBucketLabels } from "@/lib/demographics/bucketLabelScaffolding";
import { AGE_EN, DIMS_EN, INCOME_EN, URBAN_EN } from "@/lib/demographics/bucketLabelScaffolding";

// East Germany: English UI labels aligned with region census cards (ticket #1121).
export const DD_BUCKET_LABELS: CountryBucketLabels = {
  dims: DIMS_EN,
  buckets: {
    ethnicity: { german: "German", other: "Other" },
    age: AGE_EN,
    education: {
      primary_or_below: "Primary or below",
      secondary: "Secondary",
      vocational: "Vocational",
      university: "University",
    },
    income: INCOME_EN,
    urbanization: URBAN_EN,
  },
};
